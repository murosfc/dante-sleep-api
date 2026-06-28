import { getDb, USER_ID } from './firebase';

// Brazil timezone offset: UTC-3 (UTC-2 during summer, but we use -3 as default)
const TZ_OFFSET_HOURS = -3;

export interface SleepEntry {
  id: string;
  wokeUp: Date | null;
  slept: Date | null;
  isDay: boolean;
  bottle: boolean;
  createdAt: Date | null;
}

export interface BabyProfile {
  name: string | null;
  birthdate: Date | null;
  sex: string;
  feedingType: string;
  nightRoutineMinutes: number;
  targetBedtimeHour: number | null;
  targetBedtimeMinute: number | null;
}

function parseDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const d = new Date(value.trim());
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === 'object' && 'toDate' in (value as object)) {
    return (value as { toDate(): Date }).toDate();
  }
  return null;
}

export async function loadEntries(): Promise<SleepEntry[]> {
  const db = getDb();
  const doc = await db.collection('sleep_entries').doc(USER_ID).get();
  if (!doc.exists) return [];

  const data = doc.data() ?? {};
  const entries: SleepEntry[] = [];

  for (const [key, val] of Object.entries(data)) {
    if (key === 'updatedAt' || key === 'createdAt') continue;
    if (typeof val !== 'object' || val === null) continue;

    const e = val as Record<string, unknown>;
    entries.push({
      id: key,
      wokeUp: parseDate(e.wokeUp),
      slept: parseDate(e.slept),
      isDay: Boolean(e.isDay ?? true),
      bottle: Boolean(e.bottle ?? false),
      createdAt: parseDate(e.createdAt),
    });
  }

  // Sort most recent first (by slept time)
  entries.sort((a, b) => {
    const ta = a.slept?.getTime() ?? a.createdAt?.getTime() ?? 0;
    const tb = b.slept?.getTime() ?? b.createdAt?.getTime() ?? 0;
    return tb - ta;
  });

  return entries;
}

export async function loadBabyProfile(): Promise<BabyProfile | null> {
  const db = getDb();
  const doc = await db.collection('users').doc(USER_ID).get();
  if (!doc.exists) return null;

  const data = doc.data() ?? {};
  const baby = data.baby_data as Record<string, unknown> | undefined;
  if (!baby) return null;

  return {
    name: (baby.name as string | null) ?? null,
    birthdate: parseDate(baby.birthdate),
    sex: (baby.sex as string) ?? 'male',
    feedingType: (baby.feedingType as string) ?? 'breast',
    nightRoutineMinutes: Number(baby.nightRoutineMinutes ?? 30),
    targetBedtimeHour: baby.targetBedtimeHour != null ? Number(baby.targetBedtimeHour) : null,
    targetBedtimeMinute: baby.targetBedtimeMinute != null ? Number(baby.targetBedtimeMinute) : null,
  };
}

// ─── State helpers ────────────────────────────────────────────────────────────

export function isSleepingNow(entries: SleepEntry[]): boolean {
  if (!entries.length) return false;
  const latest = entries[0];
  return latest.slept !== null && latest.wokeUp === null;
}

// ─── Response builders ────────────────────────────────────────────────────────

export function answerHowLongSleeping(entries: SleepEntry[]): string {
  if (!entries.length) return 'Não há registros de sono do Dante disponíveis.';

  const latest = entries[0];
  if (!latest.slept || latest.wokeUp !== null) {
    return 'Dante não está dormindo agora.';
  }

  const diff = Date.now() - latest.slept.getTime();
  return `Dante está dormindo há ${fmtDuration(diff)}, desde as ${fmtTime(latest.slept)}.`;
}

export function answerHowLongAwake(entries: SleepEntry[]): string {
  if (!entries.length) return 'Não há registros disponíveis para o Dante.';

  const latest = entries[0];
  if (latest.slept && latest.wokeUp === null) {
    const diff = Date.now() - latest.slept.getTime();
    return `Dante está dormindo agora, não acordado. Ele dorme há ${fmtDuration(diff)}.`;
  }

  if (!latest.wokeUp) return 'Não foi possível determinar quando Dante acordou.';

  const diff = Date.now() - latest.wokeUp.getTime();
  return `Dante está acordado há ${fmtDuration(diff)}, desde as ${fmtTime(latest.wokeUp)}.`;
}

export function answerIsSleeping(entries: SleepEntry[]): string {
  if (!entries.length) return 'Não há registros disponíveis para o Dante.';

  const sleeping = isSleepingNow(entries);

  if (sleeping) {
    const latest = entries[0];
    const diff = Date.now() - latest.slept!.getTime();
    return `Sim, Dante está dormindo desde as ${fmtTime(latest.slept!)}, há ${fmtDuration(diff)}.`;
  }

  const latest = entries[0];
  if (latest.wokeUp) {
    const diff = Date.now() - latest.wokeUp.getTime();
    return `Não, Dante está acordado desde as ${fmtTime(latest.wokeUp)}, há ${fmtDuration(diff)}.`;
  }

  return 'Não tenho certeza do estado atual do Dante.';
}

export function answerLastNap(entries: SleepEntry[]): string {
  // Find the most recent completed daytime nap
  const naps = entries.filter(e => e.isDay && e.slept && e.wokeUp);

  if (!naps.length) return 'Não há registro de sonecas recentes do Dante.';

  const nap = naps[0];
  const dur = nap.wokeUp!.getTime() - nap.slept!.getTime();
  return `A última soneca do Dante foi das ${fmtTime(nap.slept!)} às ${fmtTime(nap.wokeUp!)}, com duração de ${fmtDuration(dur)}.`;
}

export function answerSleepToday(entries: SleepEntry[]): string {
  const now = new Date();
  const startOfDayBrazil = localStartOfDay(now);
  const totalMs = sumSleepInWindow(entries, startOfDayBrazil, now);

  if (totalMs === 0) return 'Dante ainda não dormiu hoje.';
  return `Dante dormiu ${fmtDuration(totalMs)} hoje.`;
}

export function answerSleep24h(entries: SleepEntry[]): string {
  const now = new Date();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const totalMs = sumSleepInWindow(entries, since, now);

  if (totalMs === 0) return 'Dante não dormiu nas últimas 24 horas.';
  return `Dante dormiu ${fmtDuration(totalMs)} nas últimas 24 horas.`;
}

export function answerLastNight(entries: SleepEntry[]): string {
  const nights = entries.filter(e => !e.isDay && e.slept && e.wokeUp);
  if (!nights.length) return 'Não há registros de sono noturno recentes do Dante.';

  const night = nights[0];
  const dur = night.wokeUp!.getTime() - night.slept!.getTime();
  const hours = dur / 3_600_000;

  let quality: string;
  if (hours >= 10) quality = 'excelente';
  else if (hours >= 8) quality = 'boa';
  else if (hours >= 6) quality = 'razoável';
  else quality = 'curta';

  return (
    `A noite foi ${quality}. ` +
    `Dante dormiu às ${fmtTime(night.slept!)}, acordou às ${fmtTime(night.wokeUp!)} ` +
    `e ficou ${fmtDuration(dur)} dormindo.`
  );
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function sumSleepInWindow(entries: SleepEntry[], from: Date, to: Date): number {
  let total = 0;
  for (const e of entries) {
    if (!e.slept) continue;
    const start = e.slept < from ? from : e.slept;
    const end = e.wokeUp ? (e.wokeUp > to ? to : e.wokeUp) : to;
    if (end > start && start < to && (e.wokeUp ?? to) > from) {
      total += end.getTime() - start.getTime();
    }
  }
  return total;
}

// Returns midnight in Brazil time (UTC-3) for a given UTC date
function localStartOfDay(utcDate: Date): Date {
  const offsetMs = TZ_OFFSET_HOURS * 3_600_000;
  const localMs = utcDate.getTime() + offsetMs;
  const localMidnight = new Date(localMs);
  localMidnight.setUTCHours(0, 0, 0, 0);
  return new Date(localMidnight.getTime() - offsetMs);
}

export function fmtDuration(ms: number): string {
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} minuto${m !== 1 ? 's' : ''}`;
  if (m === 0) return `${h} hora${h !== 1 ? 's' : ''}`;
  return `${h} hora${h !== 1 ? 's' : ''} e ${m} minuto${m !== 1 ? 's' : ''}`;
}

export function fmtTime(date: Date): string {
  // Display in Brazil local time
  const local = new Date(date.getTime() + TZ_OFFSET_HOURS * 3_600_000);
  const hh = local.getUTCHours().toString().padStart(2, '0');
  const mm = local.getUTCMinutes().toString().padStart(2, '0');
  return `${hh} horas e ${mm} minutos`;
}
