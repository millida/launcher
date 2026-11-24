import { useState } from 'react'
import { GIFT_NOTE_MAX } from '../../lib/rubies'
import { useT } from '../../i18n'

export function GiftNote({ onChange }: { onChange: (text: string) => void }) {
  const t = useT()
  const [text, setText] = useState('')
  return (
    <label className="input gift-note">
      <input
        value={text}
        maxLength={GIFT_NOTE_MAX}
        placeholder={t('Записка другу — по желанию')}
        aria-label={t('Записка к подарку')}
        data-track="gift_note"
        onChange={(e) => {
          setText(e.target.value)
          onChange(e.target.value.trim())
        }}
      />
      <small className="gift-note-n">{GIFT_NOTE_MAX - [...text].length}</small>
    </label>
  )
}
