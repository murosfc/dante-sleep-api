import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import styles from './status.module.css';

interface StatusData {
  status: 'healthy' | 'degraded' | 'error';
  timestamp: string;
  env: {
    firebaseProjectId: boolean;
    firebaseClientEmail: boolean;
    firebasePrivateKey: boolean;
    nvidiaApiKey: boolean;
    alexaSkillId: boolean;
  };
  firebase: {
    status: 'connected' | 'unconfigured' | 'error' | 'unknown';
    error: string | null;
  };
  babyStatus: {
    name: string;
    isSleeping: boolean;
    statusText: string;
    lastEvent: {
      type: 'sleep' | 'wake';
      time: string | null;
    } | null;
    nextNapPrediction: string | null;
  } | null;
}

export default function StatusPage() {
  const [data, setData] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [alexaUrl, setAlexaUrl] = useState('');

  const fetchStatus = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/status');
      if (!res.ok) {
        throw new Error(`Erro HTTP: ${res.status}`);
      }
      const json = (await res.json()) as StatusData;
      setData(json);
    } catch (err: any) {
      setError(err.message || 'Falha ao carregar o status.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    if (typeof window !== 'undefined') {
      setAlexaUrl(`${window.location.origin}/api/alexa`);
    }
  }, []);

  const handleCopy = () => {
    navigator.clipboard.writeText(alexaUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatDate = (isoString: string | null | undefined) => {
    if (!isoString) return 'Sem registro';
    const date = new Date(isoString);
    return date.toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className={styles.container}>
      <Head>
        <title>Dante Sleep API — Painel de Status</title>
        <meta name="description" content="Status operacional e diagnóstico da API do assistente de sono do Dante." />
        <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🌙</text></svg>" />
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      </Head>

      <main className={styles.content}>
        {/* Star elements for aesthetic background */}
        <div className={styles.stars}>
          <div className={`${styles.star} ${styles.star1}`}></div>
          <div className={`${styles.star} ${styles.star2}`}></div>
          <div className={`${styles.star} ${styles.star3}`}></div>
          <div className={`${styles.star} ${styles.star4}`}></div>
        </div>

        {/* Glow gradients */}
        <div className={`${styles.glow} ${styles.glowPurple}`}></div>
        <div className={`${styles.glow} ${styles.glowBlue}`}></div>

        <header className={styles.header}>
          <div className={styles.logoWrapper}>
            <span className={styles.logoEmoji}>🌙</span>
            <h1>DANTE SLEEP API</h1>
          </div>
          <p className={styles.subtitle}>Painel de Monitoramento & Integração Alexa</p>
        </header>

        {loading && !data ? (
          <div className={`${styles.card} ${styles.loadingCard}`}>
            <div className={styles.spinner}></div>
            <p>Verificando o status dos serviços...</p>
          </div>
        ) : error ? (
          <div className={`${styles.card} ${styles.errorCard}`}>
            <div className={styles.errorIcon}>❌</div>
            <h3>Erro de Conexão</h3>
            <p>{error}</p>
            <button onClick={fetchStatus} className={`${styles.btn} ${styles.btnPrimary}`}>
              Tentar Novamente
            </button>
          </div>
        ) : (
          data && (
            <div className={styles.grid}>
              {/* Primary Status Banner */}
              <div className={`${styles.card} ${styles.spanFull} ${styles.mainStatusCard}`}>
                <div className={styles.statusHeader}>
                  <div className={styles.statusIndicatorWrapper}>
                    <span className={`${styles.statusPulse} ${styles[data.status]}`}></span>
                    <span className={styles.statusLabel}>
                      {data.status === 'healthy' && 'Sistema Totalmente Operacional'}
                      {data.status === 'degraded' && 'Operação Parcial / Degradação'}
                      {data.status === 'error' && 'Sistema fora do ar'}
                    </span>
                  </div>
                  <button onClick={fetchStatus} className={styles.btnRefresh} title="Atualizar dados">
                    🔄
                  </button>
                </div>
                <p className={styles.updateTime}>Último diagnóstico: {new Date(data.timestamp).toLocaleTimeString('pt-BR')}</p>
              </div>

              {/* Baby Realtime Status Card */}
              <div className={`${styles.card} ${styles.babyCard}`}>
                <h2>Status do Dante 👶</h2>
                {data.firebase.status === 'connected' && data.babyStatus ? (
                  <div className={styles.babyInfo}>
                    <div className={styles.statusBadgeContainer}>
                      <div className={`${styles.babyStatusBadge} ${data.babyStatus.isSleeping ? styles.sleeping : styles.awake}`}>
                        {data.babyStatus.isSleeping ? '💤 Dormindo' : '🧸 Acordado'}
                      </div>
                    </div>
                    <p className={styles.descriptionText}>{data.babyStatus.statusText}</p>
                    
                    <div className={styles.statsList}>
                      <div className={styles.statItem}>
                        <span className={styles.statLabel}>Último Evento:</span>
                        <span className={styles.statValue}>
                          {data.babyStatus.lastEvent?.type === 'sleep' ? 'Dormiu em ' : 'Acordou em '}
                          {formatDate(data.babyStatus.lastEvent?.time)}
                        </span>
                      </div>
                      <div className={styles.statItem}>
                        <span className={styles.statLabel}>Previsão Próxima Soneca:</span>
                        <span className={`${styles.statValue} ${styles.highlight}`}>{data.babyStatus.nextNapPrediction}</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className={styles.missingDataWarning}>
                    <span className={styles.warningEmoji}>⚠️</span>
                    <p>Dados de sono indisponíveis.</p>
                    <p className={styles.warningDetail}>Configure a conexão com o banco de dados Firebase para exibir o status em tempo real do Dante.</p>
                  </div>
                )}
              </div>

              {/* Service Health Checklist */}
              <div className={`${styles.card} ${styles.checklistCard}`}>
                <h2>Verificação do Sistema ⚙️</h2>
                <ul className={styles.checkList}>
                  <li className={`${styles.checkItem} ${styles.ok}`}>
                    <span className={styles.checkIcon}>✓</span>
                    <div className={styles.checkDetails}>
                      <h4>API Server (Next.js)</h4>
                      <p>Servidor online e respondendo na porta web.</p>
                    </div>
                  </li>

                  <li className={`${styles.checkItem} ${data.firebase.status === 'connected' ? styles.ok : data.firebase.status === 'unconfigured' ? styles.warning : styles.danger}`}>
                    <span className={styles.checkIcon}>
                      {data.firebase.status === 'connected' && '✓'}
                      {data.firebase.status === 'unconfigured' && '⚠'}
                      {data.firebase.status === 'error' && '✗'}
                    </span>
                    <div className={styles.checkDetails}>
                      <h4>Banco de Dados (Firebase)</h4>
                      <p>
                        {data.firebase.status === 'connected' && 'Conectado com sucesso ao Firestore.'}
                        {data.firebase.status === 'unconfigured' && 'Credenciais do Firebase Firestore não encontradas no ambiente.'}
                        {data.firebase.status === 'error' && `Erro de conexão: ${data.firebase.error}`}
                      </p>
                    </div>
                  </li>

                  <li className={`${styles.checkItem} ${data.env.nvidiaApiKey ? styles.ok : styles.warning}`}>
                    <span className={styles.checkIcon}>{data.env.nvidiaApiKey ? '✓' : '⚠'}</span>
                    <div className={styles.checkDetails}>
                      <h4>Previsões Inteligentes (NVIDIA AI API)</h4>
                      <p>
                        {data.env.nvidiaApiKey 
                          ? 'Chave de API configurada. Previsões otimizadas por IA ativas.' 
                          : 'NVIDIA_API_KEY ausente. O sistema usará o algoritmo matemático local como fallback.'}
                      </p>
                    </div>
                  </li>
                </ul>
              </div>

              {/* Environment Variables Info for debugging */}
              <div className={`${styles.card} ${styles.spanFull} ${styles.debugCard}`}>
                <h2>Chaves de Ambiente (Environment) 🔑</h2>
                <div className={styles.envGrid}>
                  <div className={`${styles.envBadge} ${data.env.firebaseClientEmail ? styles.active : styles.inactive}`}>
                    <span>FIREBASE_CLIENT_EMAIL</span>
                    <span className={styles.badgeDot}></span>
                  </div>
                  <div className={`${styles.envBadge} ${data.env.firebasePrivateKey ? styles.active : styles.inactive}`}>
                    <span>FIREBASE_PRIVATE_KEY</span>
                    <span className={styles.badgeDot}></span>
                  </div>
                  <div className={`${styles.envBadge} ${data.env.firebaseProjectId ? styles.active : styles.inactive}`}>
                    <span>FIREBASE_PROJECT_ID</span>
                    <span className={styles.badgeDot}></span>
                  </div>
                  <div className={`${styles.envBadge} ${data.env.nvidiaApiKey ? styles.active : styles.inactive}`}>
                    <span>NVIDIA_API_KEY</span>
                    <span className={styles.badgeDot}></span>
                  </div>
                  <div className={`${styles.envBadge} ${data.env.alexaSkillId ? styles.active : styles.inactive}`}>
                    <span>ALEXA_SKILL_ID</span>
                    <span className={styles.badgeDot}></span>
                  </div>
                </div>
                {(data.status === 'degraded' || data.firebase.status === 'unconfigured') && (
                  <div className={styles.setupHelp}>
                    <p>💡 <strong>Como resolver o erro do Firebase:</strong> Crie um arquivo <code>.env</code> na raiz do projeto (ou adicione as variáveis na dashboard da Vercel) com os valores correspondentes da sua conta de serviço do Firebase.</p>
                  </div>
                )}
              </div>

              {/* Integration with Alexa instructions */}
              <div className={`${styles.card} ${styles.spanFull} ${styles.integrationCard}`}>
                <h2>Integração com a Alexa Skill 🗣️</h2>
                <p>Use o endpoint abaixo ao configurar a sua Alexa Custom Skill (no console de desenvolvedor da Alexa):</p>
                <div className={styles.copyUrlWrapper}>
                  <input type="text" readOnly value={alexaUrl || 'Carregando URL...'} className={styles.urlInput} id="alexaUrlInput" />
                  <button onClick={handleCopy} className={`${styles.btn} ${styles.btnPrimary} ${styles.btnCopy}`}>
                    {copied ? 'Copiado! ✓' : 'Copiar URL'}
                  </button>
                </div>
                <div className={styles.alexaDetails}>
                  <p><strong>Configuração do Endpoint:</strong> Certifique-se de selecionar a opção <strong>HTTPS</strong> no console da Alexa, apontar para a URL acima e habilitar o método <strong>POST</strong>.</p>
                </div>
              </div>
            </div>
          )
        )}
      </main>

      <footer className={styles.footer}>
        <p>API do Sono do Dante © {new Date().getFullYear()} — Feito com Next.js & TypeScript</p>
      </footer>
    </div>
  );
}
