import { FieldValue } from 'firebase-admin/firestore';
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
}

function parseDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    let str = value.trim();
    if (str.includes('T') && !str.endsWith('Z') && !/[+-]\d{2}:?\d{2}$/.test(str)) {
      str = str + '-03:00';
    }
    const d = new Date(str);
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

// ─── Registration ─────────────────────────────────────────────────────────────

export interface RegisterResult {
  success: boolean;
  message: string;
}

export async function registerSleep(
  timeSlot?: string,    // "HH:MM" from AMAZON.TIME
  durationSlot?: string // "PT5M" ISO 8601 from AMAZON.DURATION
): Promise<RegisterResult> {
  const entries = await loadEntries();

  if (isSleepingNow(entries)) {
    const diff = Date.now() - entries[0].slept!.getTime();
    return {
      success: false,
      message: `Dante já está dormindo há ${fmtDuration(diff)}. Não é possível registrar novamente.`,
    };
  }

  const sleptAt = resolveTime(timeSlot, durationSlot);
  const isDay = isDaytime(sleptAt);

  const db = getDb();
  const entryId = db.collection('sleep_entries').doc().id;
  const now = new Date().toISOString();

  await db.collection('sleep_entries').doc(USER_ID).set(
    {
      [entryId]: {
        slept: sleptAt.toISOString(),
        wokeUp: null,
        isDay,
        bottle: false,
        bottleTime: null,
        createdAt: now,
        updatedAt: now,
      },
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  const type = isDay ? 'Soneca' : 'Sono noturno';
  return {
    success: true,
    message: `${type} registrado. Dante dormiu às ${fmtTime(sleptAt)}. Bons sonhos!`,
  };
}

export async function registerAwake(
  timeSlot?: string,
  durationSlot?: string
): Promise<RegisterResult> {
  const entries = await loadEntries();
  const sleeping = entries.find(e => e.slept && !e.wokeUp);

  if (!sleeping) {
    return {
      success: false,
      message: 'Dante não está registrado como dormindo. Não há nada para encerrar.',
    };
  }

  const wokeAt = resolveTime(timeSlot, durationSlot);

  if (wokeAt < sleeping.slept!) {
    return {
      success: false,
      message: `O horário informado é anterior ao início do sono (${fmtTime(sleeping.slept!)}). Verifique e tente novamente.`,
    };
  }

  const dur = wokeAt.getTime() - sleeping.slept!.getTime();
  const db = getDb();

  await db.collection('sleep_entries').doc(USER_ID).update({
    [`${sleeping.id}.wokeUp`]: wokeAt.toISOString(),
    [`${sleeping.id}.updatedAt`]: new Date().toISOString(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return {
    success: true,
    message: `Registrado. Dante acordou às ${fmtTime(wokeAt)} após ${fmtDuration(dur)} de sono. Bom dia!`,
  };
}

// ─── Time resolution helpers ──────────────────────────────────────────────────

function resolveTime(timeSlot?: string, durationSlot?: string): Date {
  const now = new Date();
  if (durationSlot) return new Date(now.getTime() - parseDurationMs(durationSlot));
  if (timeSlot) return parseTimeSlot(timeSlot);
  return now;
}

// Parses ISO 8601 duration: PT5M, PT1H, PT1H30M, P1D
function parseDurationMs(iso: string): number {
  const m = iso.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i);
  if (!m) return 0;
  const days = parseInt(m[1] ?? '0');
  const hours = parseInt(m[2] ?? '0');
  const mins = parseInt(m[3] ?? '0');
  const secs = parseInt(m[4] ?? '0');
  return ((days * 24 + hours) * 3600 + mins * 60 + secs) * 1000;
}

// Parses "HH:MM" from Alexa AMAZON.TIME slot, resolving to Brazil local time
function parseTimeSlot(slot: string): Date {
  const [hStr, mStr] = slot.split(':');
  const h = parseInt(hStr);
  const m = parseInt(mStr ?? '0');

  const now = new Date();
  // Work in Brazil local time
  const localNow = new Date(now.getTime() + TZ_OFFSET_HOURS * 3_600_000);
  const candidate = new Date(localNow);
  candidate.setUTCHours(h, m, 0, 0);

  // If the candidate is more than 1 minute in the future, it must be yesterday
  if (candidate.getTime() > localNow.getTime() + 60_000) {
    candidate.setUTCDate(candidate.getUTCDate() - 1);
  }

  // Convert back to UTC
  return new Date(candidate.getTime() - TZ_OFFSET_HOURS * 3_600_000);
}

// Daytime = 06:00–18:29 Brazil local time; 18:30+ is night sleep
function isDaytime(date: Date): boolean {
  const local = new Date(date.getTime() + TZ_OFFSET_HOURS * 3_600_000);
  const h = local.getUTCHours();
  const m = local.getUTCMinutes();
  return h >= 6 && (h < 18 || (h === 18 && m < 30));
}
