import type { JournalDate } from '@memorilo/desktop-api'
import type { NoteExportFormat } from '../notes/note-export-menu'
import { useQuery } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDesktopConfiguration } from '../../shared/configuration'
import { desktopRequests } from '../../shared/desktop-requests'
import { desktopEffect, desktopEffectQuery } from '../../shared/effect-query'
import { usePageTitlebar } from '../../shared/page-titlebar'
import { NoteExportMenu } from '../notes/note-export-menu'
import { JournalCalendarControl } from './journal-calendar-control'
import {
  fromJournalDate,
  journalMonthBounds,
  startOfJournalMonth,
} from './journal-model'
import { journalQueryKeys } from './query-keys'

interface UseJournalCalendarTitlebarOptions {
  exporting: boolean
  onCancelExport: () => void
  onExport: (format: NoteExportFormat) => void
  onSelectDate: (journalDate: JournalDate) => void
  selectedDate: JournalDate | null
  selectingDate: boolean
  today: JournalDate | undefined
}

export function useJournalCalendarTitlebar({
  exporting,
  onCancelExport,
  onExport,
  onSelectDate,
  selectedDate,
  selectingDate,
  today,
}: UseJournalCalendarTitlebarOptions): void {
  const { t, i18n } = useTranslation('app')
  const configuration = useDesktopConfiguration()
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [activeMonth, setActiveMonth] = useState(() => startOfJournalMonth(new Date()))
  const effectiveSelectedDate = selectedDate ?? today
  const monthBounds = useMemo(() => journalMonthBounds(activeMonth), [activeMonth])
  const datesQuery = useQuery(desktopEffectQuery.queryOptions({
    enabled: calendarOpen && today !== undefined,
    queryFn: () => desktopEffect('journals.list-dates', () => desktopRequests.listJournalDates(monthBounds)),
    queryKey: journalQueryKeys.dates(monthBounds.from, monthBounds.through),
  }))
  const knownDates = useMemo(() => {
    const dates = new Set<JournalDate>(datesQuery.data ?? [])
    if (today)
      dates.add(today)
    return dates
  }, [datesQuery.data, today])

  const locale = i18n.resolvedLanguage
  if (!locale)
    throw new Error('Journal calendar requires a resolved application language')

  const openCalendar = useCallback(() => {
    if (!effectiveSelectedDate)
      return
    setActiveMonth(startOfJournalMonth(fromJournalDate(effectiveSelectedDate)))
    setCalendarOpen(true)
  }, [effectiveSelectedDate])
  const closeCalendar = useCallback(() => setCalendarOpen(false), [])
  const changeActiveMonth = useCallback((date: Date) => setActiveMonth(startOfJournalMonth(date)), [])
  const titlebar = useMemo(() => ({
    title: t('journals'),
    trailing: today && effectiveSelectedDate
      ? (
          <>
            <JournalCalendarControl
              activeMonth={activeMonth}
              calendarLabel={t('journalCalendarLabel')}
              close={closeCalendar}
              existingDates={knownDates}
              loadingDates={datesQuery.isFetching || selectingDate}
              locale={locale}
              nextMonthLabel={t('nextMonth')}
              open={calendarOpen}
              previousMonthLabel={t('previousMonth')}
              selectedDate={effectiveSelectedDate}
              today={today}
              weekStart={configuration.weekStart}
              onActiveMonthChange={changeActiveMonth}
              onOpen={openCalendar}
              onSelectDate={onSelectDate}
            />
            <NoteExportMenu exporting={exporting} onCancelExport={onCancelExport} onExport={onExport} />
          </>
        )
      : undefined,
  }), [
    activeMonth,
    calendarOpen,
    changeActiveMonth,
    closeCalendar,
    configuration.weekStart,
    datesQuery.isFetching,
    effectiveSelectedDate,
    exporting,
    knownDates,
    locale,
    onCancelExport,
    onExport,
    onSelectDate,
    openCalendar,
    selectingDate,
    t,
    today,
  ])
  usePageTitlebar(titlebar)
}
