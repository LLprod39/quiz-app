import { useState } from 'react'
import { ArrowRight, Gamepad2, MonitorUp, PartyPopper, ShieldCheck, Sparkles, Users } from 'lucide-react'
import { Link, useNavigate } from '../lib/router'
import { Button, Logo } from '../components/ui'

export function HomePage() {
  const [code, setCode] = useState('')
  const navigate = useNavigate()
  const submit = (event: React.FormEvent) => { event.preventDefault(); if (code.trim()) navigate(`/join/${code.trim().toUpperCase()}`) }
  return <main className="landing">
    <header className="landing-nav"><Logo /><Link className="text-link" to="/admin">Организатору <ArrowRight size={16} /></Link></header>
    <section className="hero-section">
      <div className="hero-copy">
        <div className="eyebrow"><Sparkles size={16} /> Праздник начинается со своих</div>
        <h1>Кто на самом деле<br /><em>знает героя?</em></h1>
        <p>Тёплая викторина из историй, фотографий и любимых мелочей. Гости отвечают с телефонов, а праздник оживает на большом экране.</p>
        <form className="join-box" onSubmit={submit}>
          <label><span>Код комнаты</span><input value={code} onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))} placeholder="АБВ123" autoComplete="off" /></label>
          <Button type="submit" disabled={code.length < 4}>Войти в игру <ArrowRight size={19} /></Button>
        </form>
        <div className="trust-row"><span><ShieldCheck size={17} /> Без регистрации</span><span><Gamepad2 size={17} /> До 100+ гостей</span><span><MonitorUp size={17} /> Работает без интернета</span></div>
      </div>
      <div className="hero-visual" aria-hidden="true">
        <div className="orb orb-a" /><div className="orb orb-b" />
        <div className="show-card show-card-main"><span className="round-label">Раунд 2 · Вопрос 7</span><h2>Где была сделана эта фотография?</h2><div className="photo-placeholder"><span>Лена, 2018</span></div><div className="answer-preview"><i>A</i> Рим</div><div className="answer-preview"><i>Б</i> Комо</div></div>
        <div className="floating-chip chip-one"><Users size={18} /> 24 игрока</div>
        <div className="floating-chip chip-two"><PartyPopper size={18} /> Все свои!</div>
      </div>
    </section>
    <section className="how-strip"><div><b>1</b><span>Создайте<br />личную викторину</span></div><i /><div><b>2</b><span>Гости войдут<br />по QR-коду</span></div><i /><div><b>3</b><span>Устройте<br />настоящее шоу</span></div></section>
  </main>
}
