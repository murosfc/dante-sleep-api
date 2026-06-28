import { SleepEntry, BabyProfile, fmtTime } from './sleep';

const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const MODELS = [
  'meta/llama-4-maverick-17b-128e-instruct',
  'meta/llama-3.1-70b-instruct',
];
const TIMEOUT_MS = 7_000; // Stay within Alexa's 8s limit

interface AiResult {
  nextNapTime: string | null;
  nextNapRationale: string | null;
  bedtimeRoutineStart: string | null;
  bedtimeRationale: string | null;
  nightWakeTime: string | null;
  nightWakeRationale: string | null;
}

export async function predictNextNap(
  entries: SleepEntry[],
  profile: BabyProfile
): Promise<string> {
  const apiKey = (process.env.NVIDIA_API_KEY ?? '').trim();
  if (!apiKey) {
    return fallbackNextNap(entries);
  }

  const prompt = buildPrompt(entries, profile);

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
      return formatPredictionSpeech(result, entries);
    } catch {
      continue;
    }
  }

  return fallbackNextNap(entries);
}

function buildPrompt(entries: SleepEntry[], profile: BabyProfile): string {
  const now = new Date();
  const nowStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

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

  const targetBed =
    profile.targetBedtimeHour != null
      ? `${profile.targetBedtimeHour.toString().padStart(2, '0')}:${(profile.targetBedtimeMinute ?? 0).toString().padStart(2, '0')}`
      : '20:00';

  const routineStart = calcRoutineStart(
    profile.targetBedtimeHour ?? 20,
    profile.targetBedtimeMinute ?? 0,
    profile.nightRoutineMinutes
  );

  return `Você é um especialista em sono infantil. Horário atual: ${nowStr}. Bebê: ${ageStr}.
Rotina noturna começa às ${routineStart}, objetivo dormir às ${targetBed}.

Histórico recente (mais recente primeiro):
${history}

Contexto atual: ${ctx}

Se o bebê está acordado: calcule a próxima soneca usando janela de vigília adequada para a idade.
Se o bebê está dormindo: calcule quando deve acordar baseado no histórico.
Se for fim de tarde e a soneca conflitar com a rotina noturna (${routineStart}), sugira soneca ponte (30-40 min) ou pule.

Responda APENAS com JSON válido (sem texto extra):
{"nextNapTime":"HH:mm - HH:mm|null","nextNapRationale":"1 frase","bedtimeRoutineStart":"HH:mm|null","bedtimeRationale":"1 frase","nightWakeTime":"HH:mm|null","nightWakeRationale":"1 frase"}`;
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
      bedtimeRoutineStart: normTime(obj.bedtimeRoutineStart as string | undefined),
      bedtimeRationale: normStr(obj.bedtimeRationale as string | undefined),
      nightWakeTime: normTime(obj.nightWakeTime as string | undefined),
      nightWakeRationale: normStr(obj.nightWakeRationale as string | undefined),
    };
  } catch {
    return emptyResult();
  }
}

function formatPredictionSpeech(result: AiResult, entries: SleepEntry[]): string {
  const sleeping = entries[0]?.slept && !entries[0]?.wokeUp;

  const parts: string[] = [];

  if (sleeping && result.nightWakeTime) {
    parts.push(`Dante deve acordar por volta das ${result.nightWakeTime}. ${result.nightWakeRationale ?? ''}`);
  } else if (!sleeping && result.nextNapTime) {
    parts.push(`A previsão da próxima soneca do Dante é das ${result.nextNapTime}. ${result.nextNapRationale ?? ''}`);
  }

  if (result.bedtimeRoutineStart) {
    parts.push(`A rotina noturna deve começar às ${result.bedtimeRoutineStart}. ${result.bedtimeRationale ?? ''}`);
  }

  if (!parts.length) return fallbackNextNap(entries);
  return parts.join(' ').trim();
}

function fallbackNextNap(entries: SleepEntry[]): string {
  const sleeping = entries[0]?.slept && !entries[0]?.wokeUp;
  if (sleeping) {
    return 'Dante está dormindo agora. Não consegui calcular quando vai acordar sem a chave de inteligência artificial configurada.';
  }

  const wokeUp = entries[0]?.wokeUp;
  if (!wokeUp) return 'Não há dados suficientes para prever a próxima soneca do Dante.';

  // Simple heuristic: 2h wake window
  const napTime = new Date(wokeUp.getTime() + 2 * 3_600_000);
  return `Baseado no histórico simples, a próxima soneca do Dante pode ser por volta das ${fmtTime(napTime)}.`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emptyResult(): AiResult {
  return {
    nextNapTime: null,
    nextNapRationale: null,
    bedtimeRoutineStart: null,
    bedtimeRationale: null,
    nightWakeTime: null,
    nightWakeRationale: null,
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
  const TZ = -3;
  const local = new Date(date.getTime() + TZ * 3_600_000);
  return `${local.getUTCHours().toString().padStart(2, '0')}:${local.getUTCMinutes().toString().padStart(2, '0')}`;
}

function fmtTime(date: Date): string {
  const TZ = -3;
  const local = new Date(date.getTime() + TZ * 3_600_000);
  const hh = local.getUTCHours().toString().padStart(2, '0');
  const mm = local.getUTCMinutes().toString().padStart(2, '0');
  return `${hh} horas e ${mm} minutos`;
}

function calcRoutineStart(bedH: number, bedM: number, routineMin: number): string {
  const totalMin = bedH * 60 + bedM - routineMin;
  const h = Math.floor(((totalMin % 1440) + 1440) / 60) % 24;
  const m = ((totalMin % 60) + 60) % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
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
