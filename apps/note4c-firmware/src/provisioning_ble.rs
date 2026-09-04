use std::sync::Arc;
use std::sync::mpsc::{Receiver, TryRecvError, channel};
use std::time::Duration;

use anyhow::{Context, Result};
use esp32_nimble::enums::{AuthReq, SecurityIOCap};
use esp32_nimble::utilities::{BleUuid, mutex::Mutex};
use esp32_nimble::{BLEAdvertisementData, BLECharacteristic, BLEDevice, NimbleProperties, uuid128};
use serde::Serialize;

use crate::provisioning::ProvisioningEvent;
use crate::provisioning_protocol::{
    ApplyStatusEnvelope, DeviceInfoEnvelope, PublicConfigEnvelope, decode_frame, encode_frames,
};

const CHARACTERISTIC_CHUNK_BYTES: usize = 180;

pub struct BleProvisioningTransport {
    events: Receiver<ProvisioningEvent>,
    status: Arc<Mutex<BLECharacteristic>>,
    stopped: bool,
}

impl BleProvisioningTransport {
    pub fn open(
        passkey: u32,
        info: &DeviceInfoEnvelope,
        config: &PublicConfigEnvelope,
    ) -> Result<Self> {
        BLEDevice::init();
        let device = BLEDevice::take();
        device
            .set_preferred_mtu(517)
            .context("setting provisioning ATT MTU failed")?;
        BLEDevice::set_device_name("Memorilo Setup").context("setting BLE device name failed")?;
        device
            .security()
            .set_auth(AuthReq::Bond | AuthReq::Mitm | AuthReq::Sc)
            .set_passkey(passkey)
            .set_io_cap(SecurityIOCap::DisplayOnly)
            .resolve_rpa();

        let (event_tx, events) = channel();
        let server = device.get_server();
        server.advertise_on_disconnect(false);

        let connected_tx = event_tx.clone();
        server.on_connect(move |server, desc| {
            let _ = server.update_conn_params(desc.conn_handle(), 24, 48, 0, 60);
            let _ = connected_tx.send(ProvisioningEvent::Connected);
        });
        let disconnected_tx = event_tx.clone();
        server.on_disconnect(move |_desc, _reason| {
            let _ = disconnected_tx.send(ProvisioningEvent::Disconnected);
        });
        let authenticated_tx = event_tx.clone();
        server.on_authentication_complete(move |server, desc, result| {
            let authenticated =
                result.is_ok() && desc.encrypted() && desc.authenticated() && desc.bonded();
            let event = if authenticated {
                ProvisioningEvent::Authenticated
            } else {
                ProvisioningEvent::AuthenticationFailed
            };
            let _ = authenticated_tx.send(event);
            if !authenticated {
                let _ = server.disconnect(desc.conn_handle());
            }
        });

        let service = server.create_service(uuid128!("7b7a1000-6c6f-4d65-8a8b-6d656d6f7269"));
        let read_security =
            NimbleProperties::READ | NimbleProperties::READ_ENC | NimbleProperties::READ_AUTHEN;
        let info_characteristic = service.lock().create_characteristic(
            uuid128!("7b7a1001-6c6f-4d65-8a8b-6d656d6f7269"),
            read_security,
        );
        info_characteristic
            .lock()
            .set_value(&encode_envelope(1, info)?);

        let config_characteristic = service.lock().create_characteristic(
            uuid128!("7b7a1002-6c6f-4d65-8a8b-6d656d6f7269"),
            read_security,
        );
        config_characteristic
            .lock()
            .set_value(&encode_envelope(2, config)?);

        let apply_characteristic = service.lock().create_characteristic(
            uuid128!("7b7a1003-6c6f-4d65-8a8b-6d656d6f7269"),
            NimbleProperties::WRITE | NimbleProperties::WRITE_ENC | NimbleProperties::WRITE_AUTHEN,
        );
        apply_characteristic.lock().on_write(move |args| {
            if !args.desc().encrypted()
                || !args.desc().authenticated()
                || !args.desc().bonded()
                || decode_frame(args.recv_data()).is_err()
            {
                args.reject();
                return;
            }
            if event_tx
                .send(ProvisioningEvent::Frame(args.recv_data().to_vec()))
                .is_err()
            {
                args.reject();
            }
        });

        let notify_security = NimbleProperties::from_bits_retain(
            esp_idf_sys::BLE_GATT_CHR_F_NOTIFY_INDICATE_AUTHEN as _,
        );
        let status = service.lock().create_characteristic(
            uuid128!("7b7a1004-6c6f-4d65-8a8b-6d656d6f7269"),
            read_security | NimbleProperties::NOTIFY | NimbleProperties::INDICATE | notify_security,
        );

        let mut advertisement = BLEAdvertisementData::new();
        advertisement
            .name("Memorilo Setup")
            .add_service_uuid(BleUuid::from_uuid128_string(
                "7b7a1000-6c6f-4d65-8a8b-6d656d6f7269",
            )?);
        device
            .get_advertising()
            .lock()
            .set_data(&mut advertisement)
            .context("setting provisioning advertisement failed")?;

        Ok(Self {
            events,
            status,
            stopped: false,
        })
    }

    pub fn start_advertising(&self, remaining: Duration) -> Result<()> {
        let duration_ms = remaining.as_millis().min(i32::MAX as u128) as i32;
        BLEDevice::take()
            .get_advertising()
            .lock()
            .start_with_duration(duration_ms)
            .context("starting provisioning advertisement failed")
    }

    pub fn try_recv(&self) -> Result<Option<ProvisioningEvent>> {
        match self.events.try_recv() {
            Ok(event) => Ok(Some(event)),
            Err(TryRecvError::Empty) => Ok(None),
            Err(TryRecvError::Disconnected) => {
                anyhow::bail!("provisioning event channel disconnected")
            }
        }
    }

    pub fn notify_status(&self, status: &ApplyStatusEnvelope) -> Result<()> {
        let value = encode_envelope(3, status)?;
        let mut characteristic = self.status.lock();
        characteristic.set_value(&value).notify();
        Ok(())
    }

    pub fn stop(&mut self) -> Result<()> {
        if self.stopped {
            return Ok(());
        }
        let device = BLEDevice::take();
        let advertising = device.get_advertising();
        if advertising.lock().is_advertising() {
            advertising
                .lock()
                .stop()
                .context("stopping provisioning advertisement failed")?;
        }
        let handles: Vec<_> = device
            .get_server()
            .connections()
            .map(|connection| connection.conn_handle())
            .collect();
        for handle in handles {
            let _ = device.get_server().disconnect(handle);
        }
        BLEDevice::deinit_full().context("deinitializing provisioning BLE failed")?;
        self.stopped = true;
        Ok(())
    }
}

impl Drop for BleProvisioningTransport {
    fn drop(&mut self) {
        if let Err(error) = self.stop() {
            log::error!("provisioning BLE cleanup failed: {error:#}");
        }
    }
}

fn encode_envelope(request_token: u32, envelope: &impl Serialize) -> Result<Vec<u8>> {
    let json = serde_json::to_vec(envelope).context("serializing provisioning envelope failed")?;
    let frames = encode_frames(request_token, &json, CHARACTERISTIC_CHUNK_BYTES)
        .map_err(|error| anyhow::anyhow!("framing provisioning envelope failed: {error:?}"))?;
    Ok(frames.into_iter().flatten().collect())
}
