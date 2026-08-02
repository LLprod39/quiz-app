import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Headphones,
  LoaderCircle,
  PartyPopper,
  ShieldCheck,
  Wifi,
} from "lucide-react";
import { Link, useNavigate, useParams, useSearchParams } from "../lib/router";
import { api, ApiError } from "../lib/api";
import type { Snapshot } from "../types";
import {
  Badge,
  Button,
  Card,
  ConnectionPill,
  Field,
  Logo,
} from "../components/ui";

const avatars = [
  "🎈",
  "🦊",
  "🐼",
  "🦁",
  "🐸",
  "🐙",
  "🦄",
  "🚀",
  "🍉",
  "🌻",
  "✨",
  "🎸",
];

export function JoinPage() {
  const { code: routeCode } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [code, setCode] = useState((routeCode || "").toUpperCase());
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [name, setName] = useState("");
  const [initial, setInitial] = useState("");
  const [avatar, setAvatar] = useState(avatars[0]);
  const [teamId, setTeamId] = useState("");
  const [needsInitial, setNeedsInitial] = useState(false);
  const [loading, setLoading] = useState(Boolean(routeCode));
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");
  const [transferAvailable, setTransferAvailable] = useState(false);
  const [transfer, setTransfer] = useState<{
    request_id: string;
    claim_token: string;
  } | null>(null);
  const role = params.get("hero") === "1" ? "hero" : "guest";
  const loadRoom = async (room = code) => {
    if (room.length < 4) return;
    setLoading(true);
    setError("");
    try {
      const snap = await api.snapshot(room);
      setSnapshot(snap);
      if (snap.teams.length && !teamId) setTeamId(snap.teams[0].id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Комната не найдена");
      setSnapshot(null);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (routeCode) void loadRoom(routeCode);
  }, [routeCode]);
  const join = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!snapshot) return void loadRoom();
    setJoining(true);
    setError("");
    setTransferAvailable(false);
    try {
      const started = performance.now();
      const result = await api.join(code, {
        display_name: name,
        patronymic_initial: initial,
        avatar,
        team_id: snapshot.event.game_mode === "team" ? teamId : null,
        role,
      });
      const latency = Math.round(performance.now() - started);
      localStorage.setItem(`device_${code}`, result.device_token);
      localStorage.setItem(`participant_${code}`, result.participant_id);
      await api.ready(code, {
        device_token: result.device_token,
        latency_ms: latency,
        media_ready: true,
        sound_ready: false,
      });
      navigate(`/play/${code}`);
    } catch (err) {
      if (err instanceof ApiError && err.message === "name_initial_required") {
        setNeedsInitial(true);
        setTransferAvailable(true);
      } else {
        const message = err instanceof Error ? err.message : "Не удалось войти";
        setError(message);
        if (message.includes("имя и буква отчества")) setTransferAvailable(true);
      }
    } finally {
      setJoining(false);
    }
  };
  const requestTransfer = async () => {
    setJoining(true);
    setError("");
    try {
      setTransfer(
        await api.requestTransfer(code, {
          display_name: name,
          patronymic_initial: initial,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось запросить перенос");
    } finally {
      setJoining(false);
    }
  };
  const claimTransfer = async () => {
    if (!transfer) return;
    setJoining(true);
    setError("");
    try {
      const result = await api.claimTransfer(
        code,
        transfer.request_id,
        transfer.claim_token,
      );
      localStorage.setItem(`device_${code}`, result.device_token);
      localStorage.setItem(`participant_${code}`, result.participant_id);
      navigate(`/play/${code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Перенос ещё не подтверждён");
    } finally {
      setJoining(false);
    }
  };
  return (
    <main
      className="join-page"
      style={
        {
          "--accent": snapshot?.event.theme.accent || "#ff6b6b",
        } as React.CSSProperties
      }
    >
      <header>
        <Link to="/">
          <Logo compact />
        </Link>
        <ConnectionPill
          state={snapshot ? "online" : loading ? "connecting" : "offline"}
        />
      </header>
      <div className="join-ambient">
        <i />
        <i />
      </div>
      <Card className="join-card">
        {!snapshot ? (
          <>
            <Badge tone="accent">
              <PartyPopper size={14} /> Вход в игру
            </Badge>
            <h1>Введите код комнаты</h1>
            <p>Шесть символов с экрана телевизора</p>
            <div className="room-code-input">
              <input
                autoFocus
                value={code}
                onChange={(e) =>
                  setCode(
                    e.target.value
                      .toUpperCase()
                      .replace(/[^A-Z0-9]/g, "")
                      .slice(0, 6),
                  )
                }
                placeholder="ABC123"
                maxLength={6}
              />
              <Button
                onClick={() => void loadRoom()}
                disabled={code.length < 4 || loading}
              >
                {loading ? <LoaderCircle className="spin" /> : <ArrowRight />}
              </Button>
            </div>
            {error && <p className="form-error">{error}</p>}
          </>
        ) : (
          <form onSubmit={join}>
            <div className="event-welcome">
              <span className="event-initial small">
                {snapshot.event.hero_name.slice(0, 1)}
              </span>
              <div>
                <small>Вы входите на</small>
                <h1>{snapshot.event.title}</h1>
                <p>Праздник в честь {snapshot.event.hero_name}</p>
              </div>
            </div>
            <Field label="Как вас зовут?">
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Например, Анна"
              />
            </Field>
            {needsInitial && (
              <Field
                label="Первая буква отчества"
                hint="В комнате уже есть гость с таким именем"
              >
                <input
                  className="initial-input"
                  value={initial}
                  onChange={(e) =>
                    setInitial(e.target.value.slice(0, 1).toUpperCase())
                  }
                  maxLength={1}
                  placeholder="С"
                />
              </Field>
            )}
            <div className="field">
              <span>Выберите аватар</span>
              <div className="avatar-picker">
                {avatars.map((value) => (
                  <button
                    type="button"
                    key={value}
                    className={avatar === value ? "selected" : ""}
                    onClick={() => setAvatar(value)}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
            {snapshot.event.game_mode === "team" && (
              <div className="field">
                <span>Выберите команду</span>
                <div className="team-picker">
                  {snapshot.teams.map((team) => (
                    <button
                      type="button"
                      key={team.id}
                      style={{ "--team": team.color } as React.CSSProperties}
                      className={teamId === team.id ? "selected" : ""}
                      onClick={() => setTeamId(team.id)}
                    >
                      <i>{team.avatar}</i>
                      <b>{team.name}</b>
                      {teamId === team.id && <Check />}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {error && <p className="form-error">{error}</p>}
            {transferAvailable && !transfer && (
              <Button type="button" variant="secondary" onClick={() => void requestTransfer()} disabled={joining}>
                <ShieldCheck /> Это я — запросить перенос
              </Button>
            )}
            {transfer && (
              <div className="transfer-state">
                <Badge tone="warning">Нужно подтверждение</Badge>
                <b>Попросите организатора разрешить перенос</b>
                <small>После подтверждения старое устройство больше не сможет отвечать.</small>
                <Button type="button" variant="secondary" onClick={() => void claimTransfer()} disabled={joining}>
                  {joining ? <LoaderCircle className="spin" /> : <Check />} Проверить подтверждение
                </Button>
              </div>
            )}
            <Button
              className="join-submit"
              type="submit"
              disabled={!name.trim() || (needsInitial && !initial && !transferAvailable) || joining || Boolean(transfer)}
            >
              {joining ? <LoaderCircle className="spin" /> : <ArrowRight />}{" "}
              {role === "hero" ? "Войти как герой" : "Я готов играть"}
            </Button>
            <div className="join-assurances">
              <span>
                <ShieldCheck /> Без регистрации
              </span>
              <span>
                <Wifi /> Автовосстановление
              </span>
              <span>
                <Headphones /> Проверьте звук
              </span>
            </div>
          </form>
        )}
      </Card>
      <Link to="/" className="back-link">
        <ArrowLeft /> На главную
      </Link>
    </main>
  );
}
