use std::fmt;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::framebuffer::FRAME_BYTES;

const INDEX_MAGIC: [u8; 4] = *b"MGLY";
const INDEX_VERSION: u16 = 1;
const INDEX_HEADER_BYTES: usize = 14;
/// Capacity of the upstream `assets` SPIFFS partition.
pub const GALLERY_CAPACITY_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_GALLERY_ASSETS: usize = 100;
pub const MIN_SLIDESHOW_INTERVAL: Duration = Duration::from_secs(5 * 60);
pub const OFFICIAL_ASSETS_PARTITION_LABEL: &str = "assets";

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
pub struct GalleryAssetId(pub u64);

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GalleryAssetMetadata {
    pub id: GalleryAssetId,
    pub name: String,
    pub created_at_unix_seconds: u64,
    pub checksum: u32,
    pub byte_length: u32,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GalleryCatalog {
    pub assets: Vec<GalleryAssetMetadata>,
    pub slideshow_interval_seconds: Option<u32>,
}

impl GalleryCatalog {
    pub fn used_bytes(&self) -> usize {
        self.assets
            .iter()
            .map(|asset| asset.byte_length as usize)
            .sum()
    }

    pub fn remaining_bytes(&self) -> usize {
        GALLERY_CAPACITY_BYTES.saturating_sub(self.used_bytes())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum GalleryRecovery {
    InvalidIndex,
    MissingAsset(GalleryAssetId),
    CorruptAsset(GalleryAssetId),
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct GalleryLoadReport {
    pub recovery: Vec<GalleryRecovery>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct GalleryDeleteOutcome {
    pub deleted: bool,
    pub orphan_cleanup_failed: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum GalleryError {
    AssetNotFound,
    CapacityExceeded,
    InvalidAssetLength { actual: usize },
    InvalidAssetName,
    InvalidOrder,
    InvalidSlideshowInterval,
    Storage(String),
}

impl fmt::Display for GalleryError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{self:?}")
    }
}

impl std::error::Error for GalleryError {}

pub trait GalleryStorage {
    fn read_index(&mut self) -> Result<Option<Vec<u8>>, GalleryError>;
    fn write_index_atomic(&mut self, bytes: &[u8]) -> Result<(), GalleryError>;
    fn read_asset(&mut self, id: GalleryAssetId) -> Result<Option<Vec<u8>>, GalleryError>;
    fn write_asset_atomic(&mut self, id: GalleryAssetId, bytes: &[u8]) -> Result<(), GalleryError>;
    fn remove_asset(&mut self, id: GalleryAssetId) -> Result<(), GalleryError>;
}

pub struct GalleryRepository<S> {
    storage: S,
    catalog: GalleryCatalog,
}

impl<S: GalleryStorage> GalleryRepository<S> {
    pub fn load(mut storage: S) -> Result<(Self, GalleryLoadReport), GalleryError> {
        let mut report = GalleryLoadReport::default();
        let mut catalog = match storage.read_index()? {
            Some(bytes) => match decode_index(&bytes) {
                Some(catalog) => catalog,
                None => {
                    report.recovery.push(GalleryRecovery::InvalidIndex);
                    GalleryCatalog::default()
                }
            },
            None => GalleryCatalog::default(),
        };

        let mut valid = Vec::with_capacity(catalog.assets.len());
        for metadata in catalog.assets.drain(..).take(MAX_GALLERY_ASSETS) {
            let asset = storage.read_asset(metadata.id)?;
            match asset {
                None => report
                    .recovery
                    .push(GalleryRecovery::MissingAsset(metadata.id)),
                Some(bytes)
                    if bytes.len() == FRAME_BYTES
                        && metadata.byte_length as usize == FRAME_BYTES
                        && checksum(&bytes) == metadata.checksum =>
                {
                    valid.push(metadata);
                }
                Some(_) => report
                    .recovery
                    .push(GalleryRecovery::CorruptAsset(metadata.id)),
            }
        }
        catalog.assets = valid;

        Ok((Self { storage, catalog }, report))
    }

    pub fn catalog(&self) -> &GalleryCatalog {
        &self.catalog
    }

    pub fn read_asset(&mut self, id: GalleryAssetId) -> Result<Vec<u8>, GalleryError> {
        let metadata = self
            .catalog
            .assets
            .iter()
            .find(|asset| asset.id == id)
            .ok_or(GalleryError::AssetNotFound)?;
        let bytes = self
            .storage
            .read_asset(id)?
            .ok_or(GalleryError::AssetNotFound)?;
        if bytes.len() != FRAME_BYTES || checksum(&bytes) != metadata.checksum {
            return Err(GalleryError::Storage("gallery asset is corrupt".into()));
        }
        Ok(bytes)
    }

    pub fn insert(
        &mut self,
        name: impl Into<String>,
        created_at_unix_seconds: u64,
        bytes: &[u8],
    ) -> Result<GalleryAssetMetadata, GalleryError> {
        if bytes.len() != FRAME_BYTES {
            return Err(GalleryError::InvalidAssetLength {
                actual: bytes.len(),
            });
        }
        let name = name.into();
        if name.is_empty() || name.chars().count() > 64 {
            return Err(GalleryError::InvalidAssetName);
        }
        if self.catalog.assets.len() >= MAX_GALLERY_ASSETS
            || self.catalog.remaining_bytes() < bytes.len()
        {
            return Err(GalleryError::CapacityExceeded);
        }
        let id = (1..=MAX_GALLERY_ASSETS as u64)
            .map(GalleryAssetId)
            .find(|id| self.catalog.assets.iter().all(|asset| asset.id != *id))
            .ok_or(GalleryError::CapacityExceeded)?;
        let metadata = GalleryAssetMetadata {
            id,
            name,
            created_at_unix_seconds,
            checksum: checksum(bytes),
            byte_length: FRAME_BYTES as u32,
        };
        self.storage.write_asset_atomic(id, bytes)?;
        let mut next = self.catalog.clone();
        next.assets.push(metadata.clone());
        if let Err(error) = self.persist_catalog(&next) {
            let _ = self.storage.remove_asset(id);
            return Err(error);
        }
        self.catalog = next;
        Ok(metadata)
    }

    pub fn delete(&mut self, id: GalleryAssetId) -> Result<GalleryDeleteOutcome, GalleryError> {
        let Some(index) = self.catalog.assets.iter().position(|asset| asset.id == id) else {
            return Ok(GalleryDeleteOutcome {
                deleted: false,
                orphan_cleanup_failed: false,
            });
        };
        let mut next = self.catalog.clone();
        next.assets.remove(index);
        self.persist_catalog(&next)?;
        self.catalog = next;
        Ok(GalleryDeleteOutcome {
            deleted: true,
            orphan_cleanup_failed: self.storage.remove_asset(id).is_err(),
        })
    }

    pub fn reorder(&mut self, order: &[GalleryAssetId]) -> Result<(), GalleryError> {
        if order.len() != self.catalog.assets.len() {
            return Err(GalleryError::InvalidOrder);
        }
        let mut next_assets = Vec::with_capacity(order.len());
        for id in order {
            let Some(asset) = self.catalog.assets.iter().find(|asset| asset.id == *id) else {
                return Err(GalleryError::InvalidOrder);
            };
            if next_assets
                .iter()
                .any(|existing: &GalleryAssetMetadata| existing.id == *id)
            {
                return Err(GalleryError::InvalidOrder);
            }
            next_assets.push(asset.clone());
        }
        let mut next = self.catalog.clone();
        next.assets = next_assets;
        self.persist_catalog(&next)?;
        self.catalog = next;
        Ok(())
    }

    pub fn set_slideshow_interval(
        &mut self,
        interval: Option<Duration>,
    ) -> Result<(), GalleryError> {
        let interval_seconds = match interval {
            Some(interval) if interval < MIN_SLIDESHOW_INTERVAL => {
                return Err(GalleryError::InvalidSlideshowInterval);
            }
            Some(interval) => Some(
                u32::try_from(interval.as_secs())
                    .map_err(|_| GalleryError::InvalidSlideshowInterval)?,
            ),
            None => None,
        };
        let mut next = self.catalog.clone();
        next.slideshow_interval_seconds = interval_seconds;
        self.persist_catalog(&next)?;
        self.catalog = next;
        Ok(())
    }

    pub fn into_storage(self) -> S {
        self.storage
    }

    fn persist_catalog(&mut self, catalog: &GalleryCatalog) -> Result<(), GalleryError> {
        let bytes = encode_index(catalog)?;
        self.storage.write_index_atomic(&bytes)
    }
}

fn encode_index(catalog: &GalleryCatalog) -> Result<Vec<u8>, GalleryError> {
    let payload = postcard::to_stdvec(catalog)
        .map_err(|_| GalleryError::Storage("gallery index encoding failed".into()))?;
    let mut bytes = Vec::with_capacity(INDEX_HEADER_BYTES + payload.len());
    bytes.extend_from_slice(&INDEX_MAGIC);
    bytes.extend_from_slice(&INDEX_VERSION.to_le_bytes());
    bytes.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    bytes.extend_from_slice(&checksum(&payload).to_le_bytes());
    bytes.extend_from_slice(&payload);
    Ok(bytes)
}

fn decode_index(bytes: &[u8]) -> Option<GalleryCatalog> {
    if bytes.len() < INDEX_HEADER_BYTES || bytes[..4] != INDEX_MAGIC {
        return None;
    }
    let version = u16::from_le_bytes(bytes[4..6].try_into().ok()?);
    let payload_length = u32::from_le_bytes(bytes[6..10].try_into().ok()?) as usize;
    let expected_checksum = u32::from_le_bytes(bytes[10..14].try_into().ok()?);
    let payload = bytes.get(INDEX_HEADER_BYTES..)?;
    if version != INDEX_VERSION
        || payload.len() != payload_length
        || checksum(payload) != expected_checksum
    {
        return None;
    }
    postcard::from_bytes(payload).ok()
}

fn checksum(bytes: &[u8]) -> u32 {
    bytes.iter().fold(0x811c9dc5, |hash, byte| {
        (hash ^ u32::from(*byte)).wrapping_mul(0x01000193)
    })
}

#[cfg(target_os = "espidf")]
const INDEX_SLOT_BYTES: usize = 32 * 1024;

#[cfg(target_os = "espidf")]
pub struct EspPartitionGalleryStorage {
    root: std::path::PathBuf,
    generation: u64,
    next_index_slot: usize,
}

#[cfg(target_os = "espidf")]
impl EspPartitionGalleryStorage {
    pub fn new() -> Result<Self, GalleryError> {
        // The upstream firmware names this 8 MiB SPIFFS partition `assets`.
        // Older releases stored raw gallery records at the same offset under
        // the custom `gallery` layout. Formatting only this partition when
        // SPIFFS cannot mount clears that legacy region while preserving NVS,
        // which contains TODO, Wi-Fi, BLE, and device configuration.
        let base_path = std::ffi::CString::new("/assets")
            .map_err(|error| GalleryError::Storage(error.to_string()))?;
        let partition_label = std::ffi::CString::new(OFFICIAL_ASSETS_PARTITION_LABEL)
            .map_err(|error| GalleryError::Storage(error.to_string()))?;
        let config = esp_idf_sys::esp_vfs_spiffs_conf_t {
            base_path: base_path.as_ptr(),
            partition_label: partition_label.as_ptr(),
            max_files: 8,
            format_if_mount_failed: true,
        };
        esp_idf_sys::esp!(unsafe { esp_idf_sys::esp_vfs_spiffs_register(&config) })
            .map_err(storage_error)?;
        Ok(Self {
            root: std::path::PathBuf::from("/assets"),
            generation: 0,
            next_index_slot: 0,
        })
    }

    fn read_index_slot(&mut self, slot: usize) -> Result<Option<(u64, Vec<u8>)>, GalleryError> {
        let path = self.root.join(format!("index-{slot}.bin"));
        let bytes = match std::fs::read(path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(storage_error(error)),
        };
        if bytes.len() < 20 {
            return Ok(None);
        }
        let header = &bytes[..20];
        if header[..4] != *b"MGS1" {
            return Ok(None);
        }
        let generation = u64::from_le_bytes(header[4..12].try_into().unwrap());
        let length = u32::from_le_bytes(header[12..16].try_into().unwrap()) as usize;
        let expected_checksum = u32::from_le_bytes(header[16..20].try_into().unwrap());
        if length > INDEX_SLOT_BYTES - 20 || bytes.len() != 20 + length {
            return Ok(None);
        }
        let payload = bytes[20..].to_vec();
        Ok((checksum(&payload) == expected_checksum).then_some((generation, payload)))
    }

    fn asset_path(&self, id: GalleryAssetId) -> Result<std::path::PathBuf, GalleryError> {
        if id.0 == 0 || id.0 > MAX_GALLERY_ASSETS as u64 {
            return Err(GalleryError::AssetNotFound);
        }
        Ok(self.root.join(format!("asset-{:03}.bin", id.0)))
    }
}

#[cfg(target_os = "espidf")]
impl GalleryStorage for EspPartitionGalleryStorage {
    fn read_index(&mut self) -> Result<Option<Vec<u8>>, GalleryError> {
        let first = self.read_index_slot(0)?;
        let second = self.read_index_slot(1)?;
        let selected = match (first, second) {
            (Some(left), Some(right)) => {
                if left.0 >= right.0 {
                    self.next_index_slot = 1;
                    left
                } else {
                    self.next_index_slot = 0;
                    right
                }
            }
            (Some(value), None) => {
                self.next_index_slot = 1;
                value
            }
            (None, Some(value)) => {
                self.next_index_slot = 0;
                value
            }
            (None, None) => return Ok(None),
        };
        self.generation = selected.0;
        Ok(Some(selected.1))
    }

    fn write_index_atomic(&mut self, bytes: &[u8]) -> Result<(), GalleryError> {
        if bytes.len() > INDEX_SLOT_BYTES - 20 {
            return Err(GalleryError::Storage("gallery index is too large".into()));
        }
        let generation = self.generation.saturating_add(1);
        let mut header = [0_u8; 20];
        header[..4].copy_from_slice(b"MGS1");
        header[4..12].copy_from_slice(&generation.to_le_bytes());
        header[12..16].copy_from_slice(&(bytes.len() as u32).to_le_bytes());
        header[16..20].copy_from_slice(&checksum(bytes).to_le_bytes());
        let mut record = Vec::with_capacity(20 + bytes.len());
        record.extend_from_slice(&header);
        record.extend_from_slice(bytes);
        let target = self
            .root
            .join(format!("index-{}.bin", self.next_index_slot));
        let temporary = self
            .root
            .join(format!("index-{}.tmp", self.next_index_slot));
        std::fs::write(&temporary, record).map_err(storage_error)?;
        std::fs::rename(&temporary, &target).map_err(storage_error)?;
        self.generation = generation;
        self.next_index_slot = 1 - self.next_index_slot;
        Ok(())
    }

    fn read_asset(&mut self, id: GalleryAssetId) -> Result<Option<Vec<u8>>, GalleryError> {
        let path = self.asset_path(id)?;
        match std::fs::read(path) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(storage_error(error)),
        }
    }

    fn write_asset_atomic(&mut self, id: GalleryAssetId, bytes: &[u8]) -> Result<(), GalleryError> {
        if bytes.len() != FRAME_BYTES {
            return Err(GalleryError::InvalidAssetLength {
                actual: bytes.len(),
            });
        }
        let target = self.asset_path(id)?;
        let temporary = target.with_extension("tmp");
        std::fs::write(&temporary, bytes).map_err(storage_error)?;
        std::fs::rename(&temporary, &target).map_err(storage_error)
    }

    fn remove_asset(&mut self, id: GalleryAssetId) -> Result<(), GalleryError> {
        let path = self.asset_path(id)?;
        match std::fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(storage_error(error)),
        }
    }
}

#[cfg(target_os = "espidf")]
fn storage_error(error: impl fmt::Display) -> GalleryError {
    GalleryError::Storage(error.to_string())
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    #[derive(Default)]
    struct MemoryStorage {
        index: Option<Vec<u8>>,
        assets: HashMap<GalleryAssetId, Vec<u8>>,
        fail_index_write: bool,
        fail_remove: bool,
    }

    impl GalleryStorage for MemoryStorage {
        fn read_index(&mut self) -> Result<Option<Vec<u8>>, GalleryError> {
            Ok(self.index.clone())
        }

        fn write_index_atomic(&mut self, bytes: &[u8]) -> Result<(), GalleryError> {
            if self.fail_index_write {
                return Err(GalleryError::Storage("index write failed".into()));
            }
            self.index = Some(bytes.to_vec());
            Ok(())
        }

        fn read_asset(&mut self, id: GalleryAssetId) -> Result<Option<Vec<u8>>, GalleryError> {
            Ok(self.assets.get(&id).cloned())
        }

        fn write_asset_atomic(
            &mut self,
            id: GalleryAssetId,
            bytes: &[u8],
        ) -> Result<(), GalleryError> {
            self.assets.insert(id, bytes.to_vec());
            Ok(())
        }

        fn remove_asset(&mut self, id: GalleryAssetId) -> Result<(), GalleryError> {
            if self.fail_remove {
                return Err(GalleryError::Storage("remove failed".into()));
            }
            self.assets.remove(&id);
            Ok(())
        }
    }

    fn frame(color: u8) -> Vec<u8> {
        vec![color; FRAME_BYTES]
    }

    #[test]
    fn inserts_reads_reorders_and_deletes_exact_frames() {
        let (mut repository, report) = GalleryRepository::load(MemoryStorage::default()).unwrap();
        assert!(report.recovery.is_empty());
        let first = repository.insert("First", 10, &frame(0x55)).unwrap();
        let second = repository.insert("Second", 20, &frame(0xaa)).unwrap();
        assert_eq!(repository.read_asset(first.id).unwrap(), frame(0x55));
        assert_eq!(repository.catalog().used_bytes(), FRAME_BYTES * 2);

        repository.reorder(&[second.id, first.id]).unwrap();
        assert_eq!(repository.catalog().assets[0].id, second.id);
        assert!(repository.delete(first.id).unwrap().deleted);
        assert_eq!(repository.catalog().assets, vec![second]);
    }

    #[test]
    fn corrupt_and_missing_assets_are_quarantined_without_losing_valid_entries() {
        let mut storage = MemoryStorage::default();
        let valid = frame(0x55);
        let catalog = GalleryCatalog {
            assets: vec![
                GalleryAssetMetadata {
                    id: GalleryAssetId(1),
                    name: "Valid".into(),
                    created_at_unix_seconds: 1,
                    checksum: checksum(&valid),
                    byte_length: FRAME_BYTES as u32,
                },
                GalleryAssetMetadata {
                    id: GalleryAssetId(2),
                    name: "Missing".into(),
                    created_at_unix_seconds: 2,
                    checksum: 1,
                    byte_length: FRAME_BYTES as u32,
                },
                GalleryAssetMetadata {
                    id: GalleryAssetId(3),
                    name: "Corrupt".into(),
                    created_at_unix_seconds: 3,
                    checksum: 2,
                    byte_length: FRAME_BYTES as u32,
                },
            ],
            slideshow_interval_seconds: None,
        };
        storage.index = Some(encode_index(&catalog).unwrap());
        storage.assets.insert(GalleryAssetId(1), valid);
        storage.assets.insert(GalleryAssetId(3), vec![0; 8]);

        let (repository, report) = GalleryRepository::load(storage).unwrap();
        assert_eq!(repository.catalog().assets.len(), 1);
        assert_eq!(
            report.recovery,
            vec![
                GalleryRecovery::MissingAsset(GalleryAssetId(2)),
                GalleryRecovery::CorruptAsset(GalleryAssetId(3)),
            ]
        );
    }

    #[test]
    fn failed_index_commit_does_not_publish_orphaned_uploads() {
        let storage = MemoryStorage {
            fail_index_write: true,
            ..MemoryStorage::default()
        };
        let (mut repository, _) = GalleryRepository::load(storage).unwrap();
        assert!(repository.insert("Image", 1, &frame(0)).is_err());
        assert!(repository.catalog().assets.is_empty());
        assert!(repository.into_storage().assets.is_empty());
    }

    #[test]
    fn validates_upload_bounds_order_and_power_safe_slideshow_interval() {
        let (mut repository, _) = GalleryRepository::load(MemoryStorage::default()).unwrap();
        assert_eq!(
            repository.insert("Image", 1, &[0; 10]).unwrap_err(),
            GalleryError::InvalidAssetLength { actual: 10 }
        );
        let asset = repository.insert("Image", 1, &frame(0)).unwrap();
        assert_eq!(
            repository.reorder(&[asset.id, asset.id]),
            Err(GalleryError::InvalidOrder)
        );
        assert_eq!(
            repository.set_slideshow_interval(Some(Duration::from_secs(60))),
            Err(GalleryError::InvalidSlideshowInterval)
        );
        repository
            .set_slideshow_interval(Some(MIN_SLIDESHOW_INTERVAL))
            .unwrap();
        assert_eq!(repository.catalog().slideshow_interval_seconds, Some(300));
    }
}
