import { Block, Group, Row, Segs, Toggle } from './SetKit'
import { TEXT_SCALES, useA11y, type TextScale } from '../lib/a11y'
import { useT } from '../i18n'

export function A11yRows() {
  const t = useT()
  const scale = useA11y((s) => s.scale)
  const contrast = useA11y((s) => s.contrast)
  return (
    <Block keys="доступность размер текста шрифт масштаб контраст зрение">
      <Group title={t('Доступность')}>
        <Row title={t('Размер интерфейса')} keys="размер текста шрифт крупнее масштаб зрение доступность">
          <Segs<TextScale>
            value={scale}
            options={TEXT_SCALES.map((s) => [s, s + '%'] as [TextScale, string])}
            onPick={(v) => useA11y.getState().setScale(v)}
          />
        </Row>
        <Row title={t('Высокий контраст')} keys="контраст зрение яркий текст доступность">
          <Toggle label={t('Высокий контраст')} on={contrast} onChange={() => useA11y.getState().setContrast(!contrast)} />
        </Row>
      </Group>
    </Block>
  )
}
