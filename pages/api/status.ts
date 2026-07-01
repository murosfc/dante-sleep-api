import type { NextApiRequest, NextApiResponse } from 'next';
import { loadEntries, loadBabyProfile, answerIsSleeping } from '../../lib/sleep';
import { predictNextNap } from '../../lib/ai';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const statusInfo = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    env: {
      firebaseProjectId: !!process.env.FIREBASE_PROJECT_ID,
      firebaseClientEmail: !!process.env.FIREBASE_CLIENT_EMAIL,
      firebasePrivateKey: !!process.env.FIREBASE_PRIVATE_KEY,
      nvidiaApiKey: !!process.env.NVIDIA_API_KEY,
      alexaSkillId: !!process.env.ALEXA_SKILL_ID,
    },
    firebase: {
      status: 'unknown',
      error: null as string | null,
    },
    babyStatus: null as {
      name: string;
      isSleeping: boolean;
      statusText: string;
      lastEvent: {
        type: 'sleep' | 'wake';
        time: string | null;
      } | null;
      nextNapPrediction: string | null;
    } | null,
  };

  try {
    // Basic verification of env vars
    if (!process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
      statusInfo.status = 'degraded';
      statusInfo.firebase.status = 'unconfigured';
      statusInfo.firebase.error = 'Credenciais do Firebase não configuradas no ambiente (.env ou Vercel).';
    } else {
      // Try to load baby profile and recent entries
      const [entries, profile] = await Promise.all([
        loadEntries(),
        loadBabyProfile(),
      ]);

      statusInfo.firebase.status = 'connected';
      
      const babyName = profile?.name || 'Dante';
      const isSleeping = entries.length > 0 && !entries[0].wokeUp;
      const statusText = answerIsSleeping(entries);
      
      let lastEvent = null;
      if (entries.length > 0) {
        const last = entries[0];
        if (last.wokeUp) {
          lastEvent = {
            type: 'wake' as const,
            time: last.wokeUp.toISOString(),
          };
        } else if (last.slept) {
          lastEvent = {
            type: 'sleep' as const,
            time: last.slept.toISOString(),
          };
        }
      }

      // Predict next nap
      let nextNap = 'Indisponível';
      if (entries.length > 0) {
        try {
          nextNap = await predictNextNap(entries, profile ?? {
            name: 'Dante',
            birthdate: null,
            sex: 'male',
            feedingType: 'breast',
          });
        } catch (e: any) {
          nextNap = `Erro na previsão: ${e.message || e}`;
        }
      }

      statusInfo.babyStatus = {
        name: babyName,
        isSleeping,
        statusText,
        lastEvent,
        nextNapPrediction: nextNap,
      };
    }
  } catch (error: any) {
    statusInfo.status = 'error';
    statusInfo.firebase.status = 'error';
    statusInfo.firebase.error = error.message || String(error);
  }

  res.status(200).json(statusInfo);
}
