import { Row, Toggle } from '../SetKit'
import { useAmbience } from '../../state/ambience'
import { useT } from '../../i18n'

export function AmbienceRows() {
  const t = useT()
  const daytime = useAmbience((s) => s.daytime)
  const seasonal = useAmbience((s) => s.seasonal)
  return (
    <>
      <Row title={t('Свет по времени суток')} keys="время суток утро вечер ночь фон лобби">
        <Toggle label={t('Свет по времени суток')} on={daytime} onChange={() => useAmbience.getState().setDaytime(!daytime)} />
      </Row>
      <Row title={t('Сезонные украшения')} keys="снег тыквы фейерверк праздник сезон лобби">
        <Toggle label={t('Сезонные украшения')} on={seasonal} onChange={() => useAmbience.getState().setSeasonal(!seasonal)} />
      </Row>
    </>
  )
}
