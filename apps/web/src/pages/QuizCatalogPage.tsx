import { useEffect, useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, Check, Clock3, ExternalLink, Gamepad2, Library, LoaderCircle, Palette, ShieldCheck } from 'lucide-react'
import { Badge, Button, Card, Empty } from '../components/ui'
import { api } from '../lib/api'
import { themeStyle, useBranding } from '../lib/branding'
import { Link, useNavigate, useParams } from '../lib/router'
import type { QuizPack } from '../types'

const difficultyLabels: Record<string, string> = { easy: 'Легко', medium: 'Средне', hard: 'Сложно' }

export function QuizPackCard({ pack, action }: { pack: QuizPack; action?: ReactNode }) {
  return <Card className="quiz-pack-card" style={themeStyle(pack.theme)}>
    <div className="quiz-pack-card-top"><span className="quiz-pack-icon">{pack.icon}</span><div className="quiz-pack-card-badges">{pack.is_custom && <Badge tone="success">Мой шаблон</Badge>}<Badge tone="accent">{difficultyLabels[pack.difficulty] || pack.difficulty}</Badge></div></div>
    <div><span className="quiz-pack-topic">{pack.topic}</span><h2>{pack.title}</h2><p>{pack.short_description}</p></div>
    <div className="quiz-pack-meta"><span><Gamepad2 size={15} /> {pack.question_count} вопросов</span><span><Clock3 size={15} /> ≈ {pack.estimated_minutes} мин.</span></div>
    <div className="quiz-pack-card-actions"><Link className="button button-secondary" to={`/quiz/${pack.slug}`}>Подробнее <ArrowRight size={16} /></Link>{action}</div>
  </Card>
}

export function QuizCatalogPage() {
  const { slug } = useParams()
  const [packs, setPacks] = useState<QuizPack[]>([])
  const [pack, setPack] = useState<QuizPack | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    setLoading(true); setError('')
    const request = slug ? api.quizPack(slug).then(setPack) : api.quizPacks().then(setPacks)
    request.catch(err => setError(err instanceof Error ? err.message : 'Не удалось загрузить каталог')).finally(() => setLoading(false))
  }, [slug])

  if (loading) return <div className="center-screen"><LoaderCircle className="spin" size={32} /><p>Открываем библиотеку…</p></div>
  if (error) return <main className="quiz-catalog-page"><QuizCatalogHeader /><Empty icon="!" title="Каталог не открылся" text={error} /></main>
  if (slug && pack) return <QuizPackDetail pack={pack} />
  return <main className="quiz-catalog-page">
    <QuizCatalogHeader />
    <section className="quiz-catalog-intro"><Badge tone="accent"><Library size={14} /> Библиотека готовых игр</Badge><h1>Выберите тему — всё остальное уже настроено</h1><p>Каждый квиз создаёт отдельное мероприятие со своим названием, знаком, описанием, цветовой схемой и набором вопросов. После установки всё можно изменить в панели организатора.</p></section>
    <section className="quiz-pack-grid">{packs.map(item => <QuizPackCard key={item.slug} pack={item} />)}</section>
    <section className="catalog-note"><ShieldCheck /><div><b>Открытые источники и прозрачные лицензии</b><p>У каждого набора указано происхождение материалов. Вопросы хранятся на сервере, поэтому готовую игру можно запускать в локальной сети без внешних API.</p></div></section>
  </main>
}

function QuizCatalogHeader({ themedPack }: { themedPack?: QuizPack }) {
  return <header className="quiz-catalog-nav"><Link className="catalog-brand" to={themedPack ? `/quiz/${themedPack.slug}` : '/'}><span>{themedPack?.icon || 'QA'}</span><b>{themedPack?.theme.brand_name || 'Quiz App'}<small>{themedPack?.theme.brand_tagline || 'каталог квиз-баттлов'}</small></b></Link><nav><Link className="text-link" to="/quizzes">Все квизы</Link><Link className="button button-secondary" to="/admin">Панель организатора</Link></nav></header>
}

function QuizPackDetail({ pack }: { pack: QuizPack }) {
  const navigate = useNavigate()
  const { refreshBranding } = useBranding()
  const [installing, setInstalling] = useState(false)
  const [installed, setInstalled] = useState(false)
  const [error, setError] = useState('')
  const authenticated = Boolean(localStorage.getItem('admin_token'))

  useEffect(() => { document.title = pack.title }, [pack.title])
  const install = async () => {
    setInstalling(true); setError('')
    try {
      await api.installQuizPack(pack.slug)
      setInstalled(true)
      await refreshBranding()
      setTimeout(() => navigate('/admin'), 500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось создать квиз')
    } finally { setInstalling(false) }
  }

  return <main className={`quiz-pack-detail decor-${pack.theme.decor}`} style={themeStyle(pack.theme)}>
    <QuizCatalogHeader themedPack={pack} />
    <section className="quiz-pack-detail-hero">
      <Link className="back-link" to="/quizzes"><ArrowLeft size={16} /> Назад в каталог</Link>
      <div className="quiz-pack-detail-grid"><div className="quiz-pack-detail-copy"><div className="quiz-pack-detail-mark">{pack.icon}</div><span className="quiz-pack-topic">{pack.topic}</span><h1>{pack.title}</h1><p>{pack.description}</p><div className="quiz-pack-detail-stats"><span><Gamepad2 /> <b>{pack.question_count}</b><small>вопросов</small></span><span><Clock3 /> <b>{pack.estimated_minutes}</b><small>минут</small></span><span><Palette /> <b>{difficultyLabels[pack.difficulty] || pack.difficulty}</b><small>сложность</small></span></div><div className="quiz-pack-install">{authenticated ? <Button onClick={() => void install()} disabled={installing || installed}>{installing ? <LoaderCircle className="spin" /> : installed ? <Check /> : <Gamepad2 />}{installed ? 'Квиз создан' : 'Создать этот квиз'}</Button> : <Link className="button button-primary" to="/admin">Войти и создать квиз <ArrowRight size={17} /></Link>}<small>Создаст отдельное мероприятие. Название, оформление и вопросы можно редактировать.</small></div>{error && <p className="form-error">{error}</p>}</div>
        <Card className="quiz-pack-preview"><span className="preview-kicker">{pack.round_title}</span><div className="preview-brand"><span>{pack.theme.logo_mark}</span><b>{pack.theme.brand_name}<small>{pack.theme.brand_tagline}</small></b></div><h2>{pack.theme.landing_title}<em>{pack.theme.landing_highlight}</em></h2><p>{pack.theme.landing_description}</p><div className="preview-palette"><i style={{ background: pack.theme.accent }} /><i style={{ background: pack.theme.secondary }} /><i style={{ background: pack.theme.panel_2 }} /><span>Своя цветовая схема</span></div></Card></div>
    </section>
    <section className="quiz-pack-detail-content"><div><span className="overline">Что внутри</span><h2>Первые вопросы</h2><div className="quiz-sample-list">{pack.sample_questions.map((question, index) => <Card key={question}><span>{String(index + 1).padStart(2, '0')}</span><p>{question}</p></Card>)}</div></div><aside><Card className="quiz-source-card"><span className="overline">Источники</span><h3>Лицензии набора</h3>{pack.sources.map(source => <div className="quiz-source-row" key={`${source.name}-${source.license}`}><a href={source.url} target="_blank" rel="noreferrer"><span><b>{source.name}</b><small>Открыть источник</small></span><ExternalLink size={15} /></a><a className="quiz-license-link" href={source.license_url} target="_blank" rel="noreferrer">{source.license} <ExternalLink size={12} /></a></div>)}{pack.disclaimer && <p>{pack.disclaimer}</p>}</Card></aside></section>
  </main>
}
