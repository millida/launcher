import { Icon } from '../components/Icon'
import { openExt } from '../lib/api'
import { BRAND_SVG, SEC_SECTIONS, TRUST_ROWS, type BrandId } from '../lib/securityContent'

export const SECURITY_URL = 'https://millida.net/launcher/bezopasnost'

function Logo({ id }: { id: BrandId }) {
  const b = BRAND_SVG[id]
  return (
    <svg width="22" height="22" viewBox={b.viewBox} role="img" aria-label={b.name} className="sec-trust-logo">
      {b.shapes.map((sh, i) => (
        <path key={i} d={sh.d} fill={sh.fill} transform={sh.transform} />
      ))}
    </svg>
  )
}

function Trust() {
  return (
    <div className="sec-trust">
      <div className="sec-trust-head">
        <span className="sec-trust-lock">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden><rect x="5" y="11" width="14" height="9"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>
        </span>
        <b>Безопасность лаунчера</b>
        <span className="sec-trust-tag">ПРОВЕРЕНО</span>
      </div>
      <ul>
        {TRUST_ROWS.map((r) => (
          <li key={r.id}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" className="sec-trust-ok" aria-hidden><circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/></svg>
            <span className="sec-trust-txt">
              <span>{r.text}</span>
              {r.id === 'vt' ? (
                <small>0 из 71, установщик Windows, 13.09.2026</small>
              ) : r.detail ? (
                <small>{r.detail}</small>
              ) : null}
            </span>
            {r.logo ? <Logo id={r.logo} /> : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function SecurityInfo({ onBack }: { onBack: () => void }) {
  return (
    <div className="sec-info">
      <button className="btn sm ghost" onClick={onBack} style={{ alignSelf: 'flex-start', marginBottom: '12px' }}>
        <Icon id="i-chev-l" /> Назад
      </button>
      <div className="sec-info-scroll">
        <Trust />
        {SEC_SECTIONS.map((s) => (
          <section key={s.id} className="sec-info-sec">
            <h4>{s.title.replace(/\*/g, '')}</h4>
            {s.intro.map((t) => (
              <p key={t} className="sec-info-say">
                {t}
              </p>
            ))}
            <details className="sec-info-more">
              <summary>Подробнее</summary>
              <ol className="sec-info-short">
                {s.steps.map((t) => (
                  <li key={t}>
                    <b>{t}</b>
                  </li>
                ))}
              </ol>
              <ol>
                {s.more.map((st) => (
                  <li key={st.title}>
                    <b>{st.title}</b>
                    <p>{st.text}</p>
                  </li>
                ))}
              </ol>
              {s.honest.length ? (
                <div className="sec-info-honest">
                  <b>Честно</b>
                  {s.honest.map((t) => (
                    <p key={t}>{t}</p>
                  ))}
                </div>
              ) : null}
            </details>
          </section>
        ))}
      </div>
      <button
        className="btn md primary"
        style={{ width: '100%', marginTop: '14px' }}
        onClick={() => openExt(SECURITY_URL)}
      >
        <Icon id="i-ext" />
        Подробнее на сайте
      </button>
    </div>
  )
}
