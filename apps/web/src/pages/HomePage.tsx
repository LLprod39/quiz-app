import { useState } from 'react'
import { ArrowRight, Gamepad2, MonitorUp, PartyPopper, ShieldCheck, Sparkles, Users } from 'lucide-react'
import { Link, useNavigate } from '../lib/router'
import { Button, Logo } from '../components/ui'
import { useBranding } from '../lib/branding'

export function HomePage() {
  const { branding } = useBranding()
  const [code, setCode] = useState('')
  const navigate = useNavigate()
  const submit = (event: React.FormEvent) => { event.preventDefault(); if (code.trim()) navigate(`/join/${code.trim().toUpperCase()}`) }
  return <main className="landing">
    <header className="landing-nav"><Logo /><Link className="text-link" to="/admin">{branding.organizer_link_label} <ArrowRight size={16} /></Link></header>
    <section className="hero-section">
      <div className="hero-copy">
        <div className="eyebrow"><Sparkles size={16} /> {branding.landing_eyebrow}</div>
        <h1>{branding.landing_title}<br /><em>{branding.landing_highlight}</em></h1>
        <p>{branding.landing_description}</p>
        <form className="join-box" onSubmit={submit}>
          <label><span>{branding.join_code_label}</span><input value={code} onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))} placeholder="АБВ123" autoComplete="off" /></label>
          <Button type="submit" disabled={code.length < 4}>{branding.join_button_label} <ArrowRight size={19} /></Button>
        </form>
        <div className="trust-row"><span><ShieldCheck size={17} /> {branding.trust_no_registration}</span><span><Gamepad2 size={17} /> {branding.trust_players}</span><span><MonitorUp size={17} /> {branding.trust_offline}</span></div>
      </div>
      <div className="hero-visual" aria-hidden="true">
        <div className="orb orb-a" /><div className="orb orb-b" />
        <div className="show-card show-card-main"><span className="round-label">Раунд 2 · Вопрос 7</span><h2>Где была сделана эта фотография?</h2><div className="photo-placeholder"><span>Лена, 2018</span></div><div className="answer-preview"><i>A</i> Рим</div><div className="answer-preview"><i>Б</i> Комо</div></div>
        <div className="floating-chip chip-one"><Users size={18} /> 24 игрока</div>
        <div className="floating-chip chip-two"><PartyPopper size={18} /> Любая тематика</div>
      </div>
    </section>
    <section className="how-strip"><div><b>1</b><span>{branding.step_format}</span></div><i /><div><b>2</b><span>{branding.step_join}</span></div><i /><div><b>3</b><span>{branding.step_show}</span></div></section>
  </main>
}
