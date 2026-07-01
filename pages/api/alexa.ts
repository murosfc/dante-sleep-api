import type { NextApiRequest, NextApiResponse } from 'next';
import { predictNextNap } from "../../lib/ai";
import {
  answerHowLongAwake,
  answerHowLongSleeping,
  answerIsSleeping,
  answerLastNap,
  answerLastNight,
  answerSleep24h,
  answerSleepToday,
  loadBabyProfile,
  loadEntries,
  registerAwake,
  registerSleep,
} from "../../lib/sleep";

type AlexaSlots = Record<string, { value?: string }> | undefined;

// ─── Alexa response builder ───────────────────────────────────────────────────

function speak(text: string, endSession = true) {
  return {
    version: '1.0',
    response: {
      outputSpeech: { type: 'PlainText', text },
      reprompt: endSession
        ? undefined
        : {
            outputSpeech: {
              type: 'PlainText',
              text: 'O que mais você quer saber sobre o Dante?',
            },
          },
      shouldEndSession: endSession,
    },
  };
}

function welcome() {
  return speak('Em que posso ser útil?', false);
}

function help() {
  return speak(
    'Você pode me perguntar: Dante está dormindo? ' +
      'Há quanto tempo está acordado? ' +
      'Quando foi a última soneca? ' +
      'Ou: quando será a próxima soneca?',
    false
  );
}

// ─── Intent handler ───────────────────────────────────────────────────────────

function slotValue(slots: AlexaSlots, name: string): string | undefined {
  return slots?.[name]?.value || undefined;
}

async function handleIntent(intentName: string, slots?: AlexaSlots): Promise<object> {
  // Standard Alexa built-ins
  if (
    intentName === 'AMAZON.StopIntent' ||
    intentName === 'AMAZON.CancelIntent'
  ) {
    return speak('Até mais!');
  }
  if (intentName === 'AMAZON.HelpIntent') {
    return help();
  }

  try {
    const [entries, profile] = await Promise.all([
      loadEntries(),
      loadBabyProfile(),
    ]);

    switch (intentName) {
      case 'IsSleepingIntent':
        return speak(answerIsSleeping(entries));

      case 'HowLongSleepingIntent':
        return speak(answerHowLongSleeping(entries));

      case 'HowLongAwakeIntent':
        return speak(answerHowLongAwake(entries));

      case 'LastNapIntent':
        return speak(answerLastNap(entries));

      case 'SleepTodayIntent':
        return speak(answerSleepToday(entries));

      case 'SleepLastDayIntent':
        return speak(answerSleep24h(entries));

      case 'LastNightIntent':
        return speak(answerLastNight(entries));

      case 'RegisterSleepIntent': {
        const result = await registerSleep(
          slotValue(slots, 'time'),
          slotValue(slots, 'duration')
        );
        return speak(result.message);
      }

      case 'RegisterAwakeIntent': {
        const result = await registerAwake(
          slotValue(slots, 'time'),
          slotValue(slots, 'duration')
        );
        return speak(result.message);
      }

      case 'NextNapIntent': {
        const text = await predictNextNap(entries, profile ?? {
          name: 'Dante',
          birthdate: null,
          sex: 'male',
          feedingType: 'breast',
        });
        return speak(text);
      }

      default:
        return speak(
          'Desculpe, não entendi essa pergunta. Tente perguntar: Dante está dormindo? ou Quando foi a última soneca?'
        );
    }
  } catch (err) {
    console.error('[alexa] error handling intent', intentName, err);
    return speak(
      'Ocorreu um erro ao buscar os dados do Dante. Tente novamente em instantes.'
    );
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body as {
    request?: {
      type?: string;
      intent?: { name?: string; slots?: AlexaSlots };
    };
    session?: { application?: { applicationId?: string } };
  };

  // Optional: validate Alexa skill ID
  const skillId = process.env.ALEXA_SKILL_ID;
  if (skillId) {
    const incomingId = body.session?.application?.applicationId;
    if (incomingId && incomingId !== skillId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
  }

  const requestType = body.request?.type;

  if (requestType === 'LaunchRequest') {
    return res.json(welcome());
  }

  if (requestType === 'IntentRequest') {
    const intentName = body.request?.intent?.name ?? '';
    const slots = body.request?.intent?.slots;
    const response = await handleIntent(intentName, slots);
    return res.json(response);
  }

  if (requestType === 'SessionEndedRequest') {
    return res.json({ version: '1.0', response: {} });
  }

  return res.json(speak('Não entendi a solicitação.'));
}
