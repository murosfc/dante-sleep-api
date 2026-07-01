import { SleepEntry, BabyProfile } from './sleep';

const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const MODELS = [
  'meta/llama-4-maverick-17b-128e-instruct',
  'meta/llama-3.1-70b-instruct',
];
const TIMEOUT_MS = 7_000; // Stay within Alexa's 8s limit
const TZ = -3;

// Sanity bounds for a daytime wake window / nap duration used when averaging history
const MIN_WINDOW_MS = 20 * 60_000;
const MAX_WINDOW_MS = 6 * 3_600_000;
const MIN_NAP_MS = 5 * 60_000;
const MAX_NAP_MS = 4 * 3_600_000;
const DEFAULT_WINDOW_MS = 2.25 * 3_600_000; // used only when there's no history at all

interface AiResult {
  nextNapTime: string | null;
  nextNapRationale: string | null;
  wakeTime: string | null;
  wakeRationale: string | null;
}

export async function predictNextNap(
  entries: SleepEntry[],
  profile: BabyProfile
): Promise<string> {
  const avgWindowMs = computeAvgAwakeWindow(entries);

  const apiKey = (process.env.NVIDIA_API_KEY ?? '').trim();
  if (!apiKey) {
    return fallbackNextNap(entries, avgWindowMs);
  }

  const prompt = buildPrompt(entries, profile, avgWindowMs);

  for (const model of MODELS) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const resp = await fetch(NVIDIA_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 256,
          temperature: 0.2,
          stream: false,
        }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));

      if (!resp.ok) continue;

      const data = (await resp.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = data.choices?.[0]?.message?.content?.trim() ?? '';
      if (!text) continue;

      const result = parseAiResponse(text);
      return formatPredictionSpeech(result, entries, avgWindowMs);
    } catch {
      continue;
    }
  }

  return fallbackNextNap(entries, avgWindowMs);
}

// Average gap between waking up and falling asleep again for daytime naps,
// computed from the entry history (most recent gaps weigh the prediction).
function computeAvgAwakeWindow(entries: SleepEntry[]): number {
  const sorted = [...entries].sort(
    (a, b) => (a.slept?.getTime() ?? 0) - (b.slept?.getTime() ?? 0)
  );

  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (!prev.wokeUp || !curr.slept || !curr.isDay) continue;

    const gap = curr.slept.getTime() - prev.wokeUp.getTime();
    if (gap >= MIN_WINDOW_MS && gap <= MAX_WINDOW_MS) gaps.push(gap);
  }

  if (!gaps.length) return DEFAULT_WINDOW_MS;

  const recent = gaps.slice(-10);
  return recent.reduce((a, b) => a + b, 0) / recent.length;
}

// Average duration of completed daytime naps, used to predict a wake time
// while Dante is currently sleeping.
function computeAvgNapDuration(entries: SleepEntry[]): number {
  const durations = entries
    .filter(e => e.isDay && e.slept && e.wokeUp)
    .slice(0, 10)
    .map(e => e.wokeUp!.getTime() - e.slept!.getTime())
    .filter(d => d >= MIN_NAP_MS && d <= MAX_NAP_MS);

  if (!durations.length) return 0;
  return durations.reduce((a, b) => a + b, 0) / durations.length;
}

function buildPrompt(entries: SleepEntry[], profile: BabyProfile, avgWindowMs: number): string {
  const now = new Date();
  const nowStr = fmtRaw(now);

  const ageStr = profile.birthdate
    ? getAgeString(profile.birthdate)
    : 'Idade desconhecida';

  const history = entries
    .slice(0, 10)
    .map(e => {
      const slept = e.slept ? fmtRaw(e.slept) : '--:--';
      const woke = e.wokeUp ? fmtRaw(e.wokeUp) : '--:--';
      const dur =
        e.slept && e.wokeUp
          ? `${Math.floor((e.wokeUp.getTime() - e.slept.getTime()) / 60_000)} min`
          : '?';
      const type = e.isDay ? 'soneca' : 'noite';
      return `- Dormiu ${slept} → Acordou ${woke} (${dur}) [${type}]`;
    })
    .join('\n');

  const latest = entries[0];
  const sleeping = latest?.slept && !latest.wokeUp;
  const ctx = sleeping
    ? `Dormindo agora desde ${fmtRaw(latest.slept!)}.`
    : latest?.wokeUp
    ? `Acordado desde ${fmtRaw(latest.wokeUp)}.`
    : 'Estado desconhecido.';

  const avgWindowStr = fmtWindowDuration(avgWindowMs);

  return `Você é um especialista em sono infantil. Horário atual: ${nowStr}. Bebê: ${ageStr}.
A janela de vigília média do Dante, calculada com base no histórico de sonecas, é de aproximadamente ${avgWindowStr}.

Histórico recente (mais recente primeiro):
${history}

Contexto atual: ${ctx}

Se o bebê está acordado: calcule o horário da próxima soneca somando a janela de vigília média (${avgWindowStr}) ao horário em que ele acordou.
Se o bebê está dormindo: calcule quando deve acordar com base na duração média das sonecas no histórico.

Responda APENAS com JSON válido (sem texto extra):
{"nextNapTime":"HH:mm - HH:mm|null","nextNapRationale":"1 frase","wakeTime":"HH:mm|null","wakeRationale":"1 frase"}`;
}

function parseAiResponse(raw: string): AiResult {
  const cleaned = raw.replace(/```[a-z]*/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return emptyResult();

  try {
    const obj = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    return {
      nextNapTime: normTime(obj.nextNapTime as string | undefined),
      nextNapRationale: normStr(obj.nextNapRationale as string | undefined),
      wakeTime: normTime(obj.wakeTime as string | undefined),
      wakeRationale: normStr(obj.wakeRationale as string | undefined),
    };
  } catch {
    return emptyResult();
  }
}

function formatPredictionSpeech(
  result: AiResult,
  entries: SleepEntry[],
  avgWindowMs: number
): string {
  const sleeping = entries[0]?.slept && !entries[0]?.wokeUp;

  if (sleeping && result.wakeTime) {
    return `Dante deve acordar por volta das ${result.wakeTime}. ${result.wakeRationale ?? ''}`.trim();
  }
  if (!sleeping && result.nextNapTime) {
    return `A previsão da próxima soneca do Dante é das ${result.nextNapTime}. ${result.nextNapRationale ?? ''}`.trim();
  }

  return fallbackNextNap(entries, avgWindowMs);
}

function fallbackNextNap(entries: SleepEntry[], avgWindowMs: number): string {
  const sleeping = entries[0]?.slept && !entries[0]?.wokeUp;

  if (sleeping) {
    const avgNapMs = computeAvgNapDuration(entries);
    if (!avgNapMs) {
      return 'Dante está dormindo agora. Ainda não há histórico suficiente para prever quando vai acordar.';
    }
    const wakeTime = new Date(entries[0].slept!.getTime() + avgNapMs);
    return `Baseado no histórico, Dante deve acordar por volta das ${fmtTime(wakeTime)}.`;
  }

  const wokeUp = entries[0]?.wokeUp;
  if (!wokeUp) return 'Não há dados suficientes para prever a próxima soneca do Dante.';

  return buildNapPrediction(wokeUp, avgWindowMs);
}

// Predicts a nap window centered on the historical average wake window, with
// a +/-15min margin, counted from the given wake-up time.
function buildNapPrediction(wokeUp: Date, avgWindowMs: number): string {
  const margin = 15 * 60_000;
  const t1 = new Date(wokeUp.getTime() + avgWindowMs - margin);
  const t2 = new Date(wokeUp.getTime() + avgWindowMs + margin);
  return (
    `Com base no histórico das janelas de hoje, a próxima soneca do Dante deve ser das ${fmtTime(t1)} às ${fmtTime(t2)}, ` +
    `cerca de ${fmtWindowDuration(avgWindowMs)} depois de acordar.`
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emptyResult(): AiResult {
  return {
    nextNapTime: null,
    nextNapRationale: null,
    wakeTime: null,
    wakeRationale: null,
  };
}

function normTime(v: string | undefined | null): string | null {
  const s = v?.trim();
  if (!s || s.toLowerCase() === 'null') return null;
  return s;
}

function normStr(v: string | undefined | null): string | null {
  const s = v?.trim();
  return s || null;
}

function fmtRaw(date: Date): string {
  const local = new Date(date.getTime() + TZ * 3_600_000);
  return `${local.getUTCHours().toString().padStart(2, '0')}:${local.getUTCMinutes().toString().padStart(2, '0')}`;
}

function fmtTime(date: Date): string {
  const local = new Date(date.getTime() + TZ * 3_600_000);
  const hh = local.getUTCHours().toString().padStart(2, '0');
  const mm = local.getUTCMinutes().toString().padStart(2, '0');
  return `${hh} horas e ${mm} minutos`;
}

function fmtWindowDuration(ms: number): string {
  const totalMin = Math.round(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} minutos`;
  if (m === 0) return `${h} hora${h !== 1 ? 's' : ''}`;
  return `${h} hora${h !== 1 ? 's' : ''} e ${m} minutos`;
}

function getAgeString(birthdate: Date): string {
  const weeks = Math.floor((Date.now() - birthdate.getTime()) / (7 * 24 * 3_600_000));
  if (weeks < 4) return `${weeks} semana${weeks !== 1 ? 's' : ''}`;
  const months = Math.floor(weeks / 4);
  const remWeeks = weeks % 4;
  if (months < 12) {
    if (remWeeks === 0) return `${months} mês${months !== 1 ? 'es' : ''}`;
    return `${months} mês${months !== 1 ? 'es' : ''} e ${remWeeks} semana${remWeeks !== 1 ? 's' : ''}`;
  }
  const years = Math.floor(months / 12);
  const remMonths = months % 12;
  if (remMonths === 0) return `${years} ano${years !== 1 ? 's' : ''}`;
  return `${years} ano${years !== 1 ? 's' : ''} e ${remMonths} mês${remMonths !== 1 ? 'es' : ''}`;
}
