import { useEffect, useMemo, useState } from 'react'
import {
  Activity, Archive, BookOpenText, CalendarDays, ChevronRight, CircleStop,
  Crown, KeyRound, Layers3, LoaderCircle, Monitor, MonitorSmartphone, Pencil, Plus,
  Save, Search, ShieldCheck, Sparkles, Trash2, UserCog, Users, X,
} from 'lucide-react'
import { api } from '../lib/api'
import type { Account, Plan, SystemAccount, SystemDashboard } from '../types'
import { Badge, Button, Card, Field } from '../components/ui'

const quotaFields = [
  ['active_quizzes', 'Активные квизы'],
  ['participants_per_game', 'Участников в комнате'],
  ['concurrent_rooms', 'Одновременные комнаты'],
  ['media_bytes', 'Медиа, МБ'],
  ['questions_per_quiz', 'Вопросов в квизе'],
  ['private_templates', 'Личные шаблоны'],
  ['games_per_month', 'Новых игр в месяц'],
  ['history_days', 'История, дней'],
] as const

const auditTitles: Record<string, string> = {
  'account.session.revoked': 'Сеанс устройства отозван',
  'account.sessions.revoked_all': 'Завершены все сеансы аккаунта',
  'account.session.renamed': 'Устройство переименовано',
  'account.password.changed': 'Пользователь сменил пароль',
  'account.password.reset.completed': 'Пароль восстановлен по ссылке',
  'account.password_reset.created': 'Создана ссылка восстановления',
  'account.avatar.updated': 'Обновлён аватар аккаунта',
  'account.profile.updated': 'Обновлён профиль аккаунта',
  'account.updated': 'Изменены права или статус аккаунта',
  'subscription.assigned': 'Назначен тариф',
  'plan.created': 'Создан тариф',
  'plan.updated': 'Обновлены настройки тарифа',
  'quiz.transferred': 'Квиз передан другому владельцу',
  'quiz.archived': 'Квиз отправлен в архив',
  'quiz_pack.published': 'Шаблон опубликован в каталоге',
  'quiz_pack.unpublished': 'Шаблон снят с публикации',
  'quiz_pack.installed': 'Шаблон установлен как квиз',
  'game_session.created': 'Открыта игровая комната',
  'game_session.stopped': 'Игровая комната остановлена',
  'screen.access.regenerated': 'Перевыпущена ссылка TV-экрана',
  'event.created': 'Создан квиз',
  'event.updated': 'Обновлены настройки квиза',
  'event.host_control.updated': 'Изменён режим ведущего',
  'event.tv_display.updated': 'Изменено оформление TV-экрана',
  'media.uploaded': 'Загружен медиафайл',
  'media.deleted': 'Удалён медиафайл',
}

type SubscriptionDraft = { account: SystemAccount; planId: string; endDate: string }
type DeleteDraft = { account: SystemAccount; transferToId: string }

export function SystemAdminPanel() {
  const [me, setMe] = useState<Account | null>(null)
  const [dashboard, setDashboard] = useState<SystemDashboard | null>(null)
  const [accounts, setAccounts] = useState<SystemAccount[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [quizzes, setQuizzes] = useState<any[]>([])
  const [templates, setTemplates] = useState<any[]>([])
  const [devices, setDevices] = useState<any>(null)
  const [audit, setAudit] = useState<any[]>([])
  const [accountDetail, setAccountDetail] = useState<any>(null)
  const [filters, setFilters] = useState({ q: '', status: '', plan: '' })
  const [subscriptionDraft, setSubscriptionDraft] = useState<SubscriptionDraft | null>(null)
  const [deleteDraft, setDeleteDraft] = useState<DeleteDraft | null>(null)
  const [planDraft, setPlanDraft] = useState<any>(null)
  const [showAllAudit, setShowAllAudit] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = async () => {
    setLoading(true); setError('')
    try {
      const current = await api.me()
      if (current.role !== 'superadmin') throw new Error('Требуются права суперадминистратора')
      setMe(current)
      const [stats, accountRows, planRows, quizRows, templateRows, deviceRows, auditRows] = await Promise.all([
        api.systemDashboard(), api.systemAccounts(), api.systemPlans(), api.systemQuizzes(),
        api.systemTemplates(), api.systemDevices(), api.systemAudit(),
      ])
      setDashboard(stats)
      setAccounts(accountRows)
      setPlans(planRows)
      setQuizzes(quizRows)
      setTemplates(templateRows)
      setDevices(deviceRows)
      setAudit(auditRows)
      if (accountDetail?.id) setAccountDetail(await api.systemAccount(accountDetail.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось открыть админку')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load() }, [])

  const visibleAccounts = useMemo(() => {
    const query = filters.q.trim().toLocaleLowerCase('ru-RU')
    return accounts.filter(row => {
      const matchesQuery = !query || `${row.display_name} ${row.phone}`.toLocaleLowerCase('ru-RU').includes(query)
      return matchesQuery && (!filters.status || row.status === filters.status) && (!filters.plan || row.plan.code === filters.plan)
    })
  }, [accounts, filters])
  const privateTemplates = templates.filter(row => row.visibility === 'private')
  const activeAdminCount = accounts.filter(row => row.role === 'superadmin' && row.status === 'active').length
  const accountNames = useMemo(() => new Map(accounts.map(row => [row.id, row.display_name])), [accounts])
  const activeAccountDevices = devices?.accounts?.filter((row: any) => !row.revoked_at) || []
  const activeScreens = devices?.screens || []

  if (loading && !me) return <div className="sa-panel-state"><LoaderCircle className="spin" /><p>Загружаем центр управления…</p></div>
  if (!me) return <Card className="sa-panel-state"><ShieldCheck size={42} /><h2>Доступ закрыт</h2><p>{error}</p></Card>

  const run = async (operation: () => Promise<unknown>, success?: string) => {
    try {
      setError(''); setNotice('')
      await operation()
      if (success) setNotice(success)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Действие не выполнено')
    }
  }
  const openAccount = async (id: string) => {
    try { setAccountDetail(await api.systemAccount(id)) }
    catch (err) { setError(err instanceof Error ? err.message : 'Не удалось открыть аккаунт') }
  }
  const createReset = async (row: SystemAccount) => {
    try {
      const result = await api.createResetLink(row.id)
      await navigator.clipboard.writeText(result.reset_url)
      setNotice(`Ссылка для «${row.display_name}» скопирована и действует 15 минут`)
    } catch (err) { setError(err instanceof Error ? err.message : 'Не удалось создать ссылку') }
  }
  const saveSubscription = async () => {
    if (!subscriptionDraft) return
    const current_period_end = subscriptionDraft.endDate ? new Date(`${subscriptionDraft.endDate}T23:59:59Z`).toISOString() : null
    await run(
      () => api.assignSubscription(subscriptionDraft.account.id, { plan_id: subscriptionDraft.planId, source: 'manual', current_period_end }),
      `Тариф аккаунта «${subscriptionDraft.account.display_name}» обновлён`,
    )
    setSubscriptionDraft(null)
  }
  const saveDelete = async () => {
    if (!deleteDraft || !deleteDraft.transferToId) return
    await run(
      () => api.updateSystemAccount(deleteDraft.account.id, { status: 'deleted', transfer_to_id: deleteDraft.transferToId }),
      `Аккаунт «${deleteDraft.account.display_name}» мягко удалён`,
    )
    setDeleteDraft(null)
  }
  const editPlan = (plan: Plan) => setPlanDraft({ ...plan, quotas: { ...plan.quotas } })
  const createPlan = () => setPlanDraft({
    id: null, code: '', name: '', description: '', price_minor: null, currency: 'KZT',
    is_public: false, is_active: true, sort_order: plans.length, provider_price_id: null,
    quotas: Object.fromEntries(quotaFields.map(([key]) => [key, null])),
  })
  const savePlan = async () => {
    if (!planDraft) return
    const payload = { ...planDraft, price_minor: planDraft.price_minor === '' ? null : Number(planDraft.price_minor), sort_order: Number(planDraft.sort_order) }
    await run(
      () => planDraft.id ? api.updateSystemPlan(planDraft.id, payload) : api.createSystemPlan(payload),
      planDraft.id ? 'Настройки тарифа сохранены' : 'Новый тариф создан',
    )
    setPlanDraft(null)
  }

  return <div className="sa-page sa-embedded">
    <div className="sa-main">
      {error && <div className="sa-toast is-error">{error}<button aria-label="Закрыть ошибку" onClick={() => setError('')}><X /></button></div>}
      {notice && <div className="sa-toast is-success">{notice}<button aria-label="Закрыть уведомление" onClick={() => setNotice('')}><X /></button></div>}

      {dashboard && <section className="sa-metric-strip" aria-label="Сводка платформы">
        <Metric target="accounts" icon={<Users />} value={dashboard.accounts} label="аккаунтов" detail={`${dashboard.active_accounts} активны`} />
        <Metric target="content" icon={<BookOpenText />} value={dashboard.quizzes} label="квизов" detail="во всей системе" />
        <Metric target="content" icon={<Sparkles />} value={dashboard.active_rooms} label="комнат" detail="сейчас в эфире" hot={dashboard.active_rooms > 0} />
        <Metric target="operations" icon={<MonitorSmartphone />} value={dashboard.active_devices} label="устройств" detail="с активной сессией" />
        <Metric target="operations" icon={<Monitor />} value={devices?.screens?.length || 0} label="TV-экранов" detail="зарегистрировано" />
      </section>}

      <section className="sa-section" id="accounts">
        <SectionHeading title="Аккаунты" />
        <div className="sa-filterbar">
          <label className="sa-search"><Search /><input aria-label="Поиск аккаунтов" value={filters.q} onChange={event => setFilters({ ...filters, q: event.target.value })} placeholder="Имя или телефон" /></label>
          <select aria-label="Фильтр по статусу" value={filters.status} onChange={event => setFilters({ ...filters, status: event.target.value })}><option value="">Любой статус</option><option value="active">Активные</option><option value="blocked">Заблокированные</option><option value="deleted">Удалённые</option></select>
          <select aria-label="Фильтр по тарифу" value={filters.plan} onChange={event => setFilters({ ...filters, plan: event.target.value })}><option value="">Любой тариф</option>{plans.map(plan => <option key={plan.id} value={plan.code}>{plan.name}</option>)}</select>
          {(filters.q || filters.status || filters.plan) && <button className="sa-clear" onClick={() => setFilters({ q: '', status: '', plan: '' })}><X /> Сбросить</button>}
        </div>
        {visibleAccounts.length ? <div className="sa-account-grid">{visibleAccounts.map(row => <AccountCard key={row.id} row={row} plans={plans} protectedAdmin={row.role === 'superadmin' && row.status === 'active' && activeAdminCount <= 1} onOpen={() => void openAccount(row.id)} onPlan={() => setSubscriptionDraft({ account: row, planId: row.plan.id, endDate: '' })} onReset={() => void createReset(row)} onStatus={() => void run(() => api.updateSystemAccount(row.id, { status: row.status === 'active' ? 'blocked' : 'active' }))} onRole={() => void run(() => api.updateSystemAccount(row.id, { role: row.role === 'superadmin' ? 'user' : 'superadmin' }))} onDelete={() => { const target = accounts.find(item => item.id !== row.id && item.status === 'active'); if (target) setDeleteDraft({ account: row, transferToId: target.id }); else setError('Нет активного аккаунта для передачи контента') }} />)}</div> : <EmptyState icon={<Search />} title="Ничего не найдено" text="Измените запрос или сбросьте фильтры." />}
      </section>

      <section className="sa-section" id="content">
        <SectionHeading title="Квизы и шаблоны" />
        <div className="sa-content-layout">
          <div className="sa-content-column"><div className="sa-subheading"><div><BookOpenText /><h3>Квизы</h3></div><Badge>{quizzes.length}</Badge></div>
            {quizzes.length ? <div className="sa-quiz-grid">{quizzes.map(row => <QuizCard key={row.id} row={row} accounts={accounts} onChanged={load} onError={setError} />)}</div> : <EmptyState icon={<BookOpenText />} title="Квизов пока нет" text="Они появятся после создания первого квиза организатором." />}
          </div>
          <div className="sa-content-column"><div className="sa-subheading"><div><Layers3 /><h3>Личные шаблоны</h3></div><Badge>{privateTemplates.length}</Badge></div>
            {privateTemplates.length ? <div className="sa-template-stack">{privateTemplates.map(row => <TemplateCard key={row.id} row={row} onChanged={load} onError={setError} />)}</div> : <EmptyState icon={<Layers3 />} title="Личных шаблонов пока нет" text="Когда организатор сохранит свой шаблон, здесь появится управление публикацией." />}
          </div>
        </div>
      </section>

      <section className="sa-section" id="plans">
        <div className="sa-heading-row"><SectionHeading title="Тарифы" /><button className="sa-inline-action" onClick={createPlan}><Plus /> Добавить</button></div>
        <div className="sa-plan-grid">{plans.map(plan => <PlanCard key={plan.id} plan={plan} onEdit={() => editPlan(plan)} />)}</div>
      </section>

      <section className="sa-section" id="operations">
        <SectionHeading title="Безопасность" />
        <div className="sa-operations-grid">
          <Card className="sa-ops-card"><div className="sa-subheading"><div><MonitorSmartphone /><h3>Активные устройства</h3></div><Badge>{activeAccountDevices.length}</Badge></div><div className="sa-device-list">{activeAccountDevices.length ? activeAccountDevices.slice(0, 8).map((row: any) => <div key={row.id}><span className="sa-device-icon">{row.os?.includes('Android') || row.os?.includes('iOS') ? '📱' : '💻'}</span><div><b>{row.account.name}</b><small>{row.device_name} · {row.ip_address || 'IP не определён'}</small></div><button onClick={() => void run(() => api.revokeSystemSession(row.account.id, row.id), 'Сеанс устройства отозван')}>Отключить</button></div>) : <MiniEmpty text="Активных устройств нет" />}</div>{activeScreens.length > 0 && <><div className="sa-subheading sa-screen-heading"><div><Monitor /><h3>TV-экраны</h3></div><Badge>{activeScreens.length}</Badge></div><div className="sa-device-list">{activeScreens.slice(0, 8).map((row: any) => <div key={row.id}><span className="sa-device-icon">📺</span><div><b>Комната {row.room}</b><small>{row.browser} · {row.os} · {row.ip_address || 'IP не определён'}</small></div><Badge tone="success">Онлайн</Badge></div>)}</div></>}</Card>
          <Card className="sa-ops-card sa-audit-card"><div className="sa-subheading"><div><Activity /><h3>История изменений</h3></div><Badge>{audit.length}</Badge></div><div className="sa-audit-timeline">{audit.slice(0, showAllAudit ? 30 : 6).map((row: any) => <AuditItem key={row.id} row={row} actorName={accountNames.get(row.actor_account_id)} />)}</div>{audit.length > 6 && <button className="sa-show-more" onClick={() => setShowAllAudit(!showAllAudit)}>{showAllAudit ? 'Свернуть' : `Ещё ${Math.min(24, audit.length - 6)}`}<ChevronRight /></button>}</Card>
        </div>
      </section>
    </div>

    {accountDetail && <AccountDetail detail={accountDetail} onClose={() => setAccountDetail(null)} onChanged={load} />}
    {subscriptionDraft && <SubscriptionDialog draft={subscriptionDraft} plans={plans} onChange={setSubscriptionDraft} onClose={() => setSubscriptionDraft(null)} onSave={() => void saveSubscription()} />}
    {deleteDraft && <DeleteAccountDialog draft={deleteDraft} accounts={accounts} onChange={setDeleteDraft} onClose={() => setDeleteDraft(null)} onSave={() => void saveDelete()} />}
    {planDraft && <PlanDialog draft={planDraft} onChange={setPlanDraft} onClose={() => setPlanDraft(null)} onSave={() => void savePlan()} />}
  </div>
}

function Metric({ target, icon, value, label, detail, hot = false }: { target: string; icon: React.ReactNode; value: number; label: string; detail: string; hot?: boolean }) {
  return <a href={`#${target}`} onClick={event => { event.preventDefault(); document.getElementById(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }} className={hot ? 'is-hot' : ''} aria-label={`${label}: ${value}. Перейти к разделу`}><span>{icon}</span><strong>{value}</strong><div><b>{label}</b><small>{detail}</small></div><ChevronRight /></a>
}

function SectionHeading({ title }: { title: string }) {
  return <div className="sa-section-heading"><h2>{title}</h2></div>
}

function EmptyState({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return <div className="sa-empty"><span>{icon}</span><h4>{title}</h4><p>{text}</p></div>
}

function MiniEmpty({ text }: { text: string }) {
  return <div className="sa-mini-empty"><span>✦</span>{text}</div>
}

function AccountCard({ row, protectedAdmin, onOpen, onPlan, onReset, onStatus, onRole, onDelete }: {
  row: SystemAccount; plans: Plan[]; protectedAdmin: boolean; onOpen: () => void; onPlan: () => void; onReset: () => void; onStatus: () => void; onRole: () => void; onDelete: () => void
}) {
  return <article className="sa-account-card">
    <header><span className="sa-account-avatar">{row.avatar_kind === 'upload' ? <img src={row.avatar} alt="" /> : row.avatar}</span><div><h3>{row.display_name}</h3><p>{row.phone}</p></div><button className="sa-open-account" onClick={onOpen}>Карточка <ChevronRight /></button></header>
    <div className="sa-account-badges"><Badge tone={row.status === 'active' ? 'success' : row.status === 'blocked' ? 'warning' : 'danger'}>{statusLabel(row.status)}</Badge>{row.role === 'superadmin' && <Badge tone="accent"><ShieldCheck /> Суперадмин</Badge>}</div>
    <div className="sa-account-stats"><div><strong>{row.quiz_count}</strong><span>квизов</span></div><div><strong>{row.active_session_count}</strong><span>устройств</span></div><button onClick={onPlan}><Crown /><span><small>Тариф</small><b>{row.plan.name}</b></span><Pencil /></button></div>
    <footer><button onClick={onReset}><KeyRound /> Сброс пароля</button><button disabled={protectedAdmin} onClick={onStatus}>{row.status === 'active' ? 'Блокировать' : 'Восстановить'}</button><button disabled={protectedAdmin} onClick={onRole}><UserCog /> {row.role === 'superadmin' ? 'Снять роль' : 'Сделать admin'}</button>{row.status !== 'deleted' && <button className="is-danger" disabled={protectedAdmin} onClick={onDelete} aria-label={`Удалить аккаунт ${row.display_name}`}><Trash2 /></button>}</footer>
  </article>
}

function QuizCard({ row, accounts, onChanged, onError }: { row: any; accounts: SystemAccount[]; onChanged: () => Promise<void>; onError: (message: string) => void }) {
  const activeRoom = row.active_rooms?.[0]
  const execute = async (operation: () => Promise<unknown>) => { try { await operation(); await onChanged() } catch (err) { onError(err instanceof Error ? err.message : 'Действие не выполнено') } }
  return <article className="sa-quiz-card"><header><span>QZ</span><div><h4>{row.title}</h4><p>{row.owner.name} · {row.owner.phone}</p></div><Badge tone={activeRoom ? 'success' : row.status === 'archived' ? 'warning' : 'neutral'}>{activeRoom ? 'В эфире' : statusLabel(row.status)}</Badge></header>{activeRoom ? <div className="sa-live-room"><span><i />Комната <b>{activeRoom.join_code}</b></span><button onClick={() => void execute(() => api.stopSystemSession(activeRoom.id))}><CircleStop /> Остановить</button></div> : <div className="sa-quiz-controls"><select aria-label={`Передать квиз ${row.title}`} defaultValue="" onChange={event => event.target.value && void execute(() => api.transferSystemQuiz(row.id, event.target.value))}><option value="">Передать владельцу…</option>{accounts.filter(account => account.status === 'active' && account.id !== row.owner.id).map(account => <option key={account.id} value={account.id}>{account.display_name}</option>)}</select>{row.status !== 'archived' && <button onClick={() => void execute(() => api.archiveSystemQuiz(row.id))}><Archive /> В архив</button>}</div>}<small>Обновлён {new Date(row.updated_at).toLocaleDateString('ru-RU')}</small></article>
}

function TemplateCard({ row, onChanged, onError }: { row: any; onChanged: () => Promise<void>; onError: (message: string) => void }) {
  const execute = async () => { try { row.publication_id ? await api.unpublishSystemTemplate(row.publication_id) : await api.publishSystemTemplate(row.id); await onChanged() } catch (err) { onError(err instanceof Error ? err.message : 'Действие не выполнено') } }
  return <article className="sa-template-card"><span><Layers3 /></span><div><h4>{row.title}</h4><p>{row.owner?.name || 'Без владельца'} · {row.slug}</p></div><button className={row.publication_id ? 'is-published' : ''} onClick={() => void execute()}>{row.publication_id ? 'Опубликован · снять' : 'Опубликовать'}</button></article>
}

function PlanCard({ plan, onEdit }: { plan: Plan; onEdit: () => void }) {
  return <article className={`sa-plan-card ${plan.code === 'pro' ? 'is-featured' : ''}`}><header><div><Badge tone={plan.code === 'pro' ? 'accent' : 'neutral'}>{plan.is_public ? 'Публичный' : 'Скрытый'}</Badge><h3>{plan.name}</h3><p>{plan.description}</p></div><button onClick={onEdit}><Pencil /> Изменить</button></header><div className="sa-plan-price"><strong>{plan.price_minor == null ? 'Бесплатно' : `${plan.price_minor.toLocaleString('ru-RU')} ${plan.currency}`}</strong><span>{plan.is_active ? 'активен' : 'отключён'}</span></div><div className="sa-quota-chips">{quotaFields.map(([key, label]) => { const value = plan.quotas[key]; return <span key={key}><small>{label}</small><b>{value == null ? 'Без лимита' : key === 'media_bytes' ? `${Math.round(value / 1024 / 1024)} МБ` : value}</b></span> })}</div></article>
}

function AuditItem({ row, actorName }: { row: any; actorName?: string }) {
  return <div><span><Activity /></span><div><b>{auditTitles[row.action] || humanizeAction(row.action)}</b><small>{new Date(row.created_at).toLocaleString('ru-RU')} · {actorName || 'Система'}</small></div></div>
}

function Modal({ children, onClose, size = 'medium' }: { children: React.ReactNode; onClose: () => void; size?: 'medium' | 'large' }) {
  return <div className="sa-modal-backdrop" onClick={onClose}><div className={`sa-modal sa-modal-${size}`} onClick={event => event.stopPropagation()}>{children}</div></div>
}

function ModalHeader({ eyebrow, title, text, onClose }: { eyebrow: string; title: string; text: string; onClose: () => void }) {
  return <header className="sa-modal-header"><div><span>{eyebrow}</span><h2>{title}</h2><p>{text}</p></div><button aria-label="Закрыть" onClick={onClose}><X /></button></header>
}

function SubscriptionDialog({ draft, plans, onChange, onClose, onSave }: { draft: SubscriptionDraft; plans: Plan[]; onChange: (draft: SubscriptionDraft) => void; onClose: () => void; onSave: () => void }) {
  return <Modal onClose={onClose}><ModalHeader eyebrow="Подписка" title={draft.account.display_name} text="Назначьте тариф и при необходимости укажите дату окончания." onClose={onClose} /><div className="sa-modal-form"><Field label="Тариф"><select value={draft.planId} onChange={event => onChange({ ...draft, planId: event.target.value })}>{plans.map(plan => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></Field><Field label="Действует до" hint="Оставьте пустым для бессрочного назначения"><input type="date" value={draft.endDate} onChange={event => onChange({ ...draft, endDate: event.target.value })} /></Field></div><footer className="sa-modal-actions"><Button variant="ghost" onClick={onClose}>Отмена</Button><Button onClick={onSave}><Save /> Назначить тариф</Button></footer></Modal>
}

function DeleteAccountDialog({ draft, accounts, onChange, onClose, onSave }: { draft: DeleteDraft; accounts: SystemAccount[]; onChange: (draft: DeleteDraft) => void; onClose: () => void; onSave: () => void }) {
  const candidates = accounts.filter(row => row.id !== draft.account.id && row.status === 'active')
  return <Modal onClose={onClose}><ModalHeader eyebrow="Мягкое удаление" title={`Удалить «${draft.account.display_name}»?`} text="Телефон останется зарезервирован, а квизы и шаблоны нужно передать активному аккаунту." onClose={onClose} /><div className="sa-warning-box"><Trash2 /><p>Сеансы аккаунта будут немедленно отозваны. Данные не удаляются физически.</p></div><div className="sa-modal-form"><Field label="Новый владелец контента"><select value={draft.transferToId} onChange={event => onChange({ ...draft, transferToId: event.target.value })}>{candidates.map(row => <option key={row.id} value={row.id}>{row.display_name} · {row.phone}</option>)}</select></Field></div><footer className="sa-modal-actions"><Button variant="ghost" onClick={onClose}>Отмена</Button><Button variant="danger" disabled={!draft.transferToId} onClick={onSave}><Trash2 /> Удалить аккаунт</Button></footer></Modal>
}

function PlanDialog({ draft, onChange, onClose, onSave }: { draft: any; onChange: (draft: any) => void; onClose: () => void; onSave: () => void }) {
  const setQuota = (key: string, raw: string) => {
    const value = raw === '' ? null : Number(raw)
    onChange({ ...draft, quotas: { ...draft.quotas, [key]: key === 'media_bytes' && value != null ? value * 1024 * 1024 : value } })
  }
  return <Modal onClose={onClose} size="large"><ModalHeader eyebrow={draft.id ? 'Редактор тарифа' : 'Новый тариф'} title={draft.id ? draft.name : 'Создайте тариф'} text="Пустое поле квоты означает отсутствие тарифного ограничения." onClose={onClose} /><div className="sa-plan-form"><Field label="Стабильный код"><input required disabled={Boolean(draft.id)} value={draft.code} onChange={event => onChange({ ...draft, code: event.target.value.toLowerCase() })} placeholder="business" /></Field><Field label="Название"><input required value={draft.name} onChange={event => onChange({ ...draft, name: event.target.value })} placeholder="Business" /></Field><Field label="Цена"><input type="number" min="0" value={draft.price_minor ?? ''} onChange={event => onChange({ ...draft, price_minor: event.target.value })} placeholder="0" /></Field><Field label="Валюта"><input maxLength={3} value={draft.currency} onChange={event => onChange({ ...draft, currency: event.target.value.toUpperCase() })} /></Field><Field label="Описание"><textarea value={draft.description} onChange={event => onChange({ ...draft, description: event.target.value })} /></Field><div className="sa-quota-form"><h3>Квоты</h3>{quotaFields.map(([key, label]) => { const stored = draft.quotas?.[key]; const display = key === 'media_bytes' && stored != null ? Math.round(stored / 1024 / 1024) : stored; return <Field key={key} label={label}><input type="number" min="0" value={display ?? ''} onChange={event => setQuota(key, event.target.value)} placeholder="Без лимита" /></Field> })}</div><div className="sa-plan-switches"><label><input type="checkbox" checked={draft.is_public} onChange={event => onChange({ ...draft, is_public: event.target.checked })} /> Показывать пользователям</label><label><input type="checkbox" checked={draft.is_active} onChange={event => onChange({ ...draft, is_active: event.target.checked })} /> Тариф активен</label></div></div><footer className="sa-modal-actions"><Button variant="ghost" onClick={onClose}>Отмена</Button><Button disabled={!draft.code || !draft.name} onClick={onSave}><Save /> Сохранить тариф</Button></footer></Modal>
}

function AccountDetail({ detail, onClose, onChanged }: { detail: any; onClose: () => void; onChanged: () => Promise<void> }) {
  return <Modal onClose={onClose} size="large"><ModalHeader eyebrow="Карточка аккаунта" title={detail.display_name} text={`${detail.phone} · ${detail.plan.name} · ${statusLabel(detail.status)}`} onClose={onClose} /><div className="sa-detail-grid"><section><h3>Квизы</h3>{detail.quizzes.length ? detail.quizzes.map((row: any) => <div className="sa-detail-row" key={row.id}><div><b>{row.title}</b><small>{statusLabel(row.status)}</small></div>{row.active_rooms.map((room: any) => <Button variant="ghost" key={room.id} onClick={() => void api.stopSystemSession(room.id).then(onChanged)}>Остановить {room.join_code}</Button>)}</div>) : <MiniEmpty text="Квизов нет" />}</section><section><h3>Устройства</h3>{detail.devices.length ? detail.devices.map((row: any) => <div className="sa-detail-row" key={row.id}><div><b>{row.device_name}</b><small>{row.os} · {row.ip_address}</small></div>{!row.revoked_at && <Button variant="ghost" onClick={() => void api.revokeSystemSession(detail.id, row.id).then(onChanged)}>Отозвать</Button>}</div>) : <MiniEmpty text="Устройств нет" />}</section><section><h3>История игр</h3>{detail.history.length ? detail.history.slice(0, 8).map((row: any) => <div className="sa-detail-row" key={row.participant_id}><div><b>{row.event_title}</b><small>{row.join_code} · {new Date(row.played_at).toLocaleDateString('ru-RU')}</small></div><Badge>{row.correct_count} верно</Badge></div>) : <MiniEmpty text="Игр пока нет" />}</section><section><h3>Действия аккаунта</h3>{detail.audit.length ? detail.audit.slice(0, 8).map((row: any) => <div className="sa-detail-row" key={row.id}><div><b>{auditTitles[row.action] || humanizeAction(row.action)}</b><small>{new Date(row.created_at).toLocaleString('ru-RU')}</small></div></div>) : <MiniEmpty text="Записей пока нет" />}</section></div></Modal>
}

function statusLabel(status: string) {
  return ({ active: 'Активен', blocked: 'Заблокирован', deleted: 'Удалён', archived: 'В архиве', draft: 'Черновик', ready: 'Готов' } as Record<string, string>)[status] || status
}

function humanizeAction(action: string) {
  return action.replaceAll('_', ' ').replaceAll('.', ' · ').replace(/^./, char => char.toUpperCase())
}
