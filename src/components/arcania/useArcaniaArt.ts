import { ART_BUNDLE } from './content'
import { useMediaGroup } from '../../lib/media'

/// Картинки страницы Arcania лежат не в установщике, а в кэше медиа (один пакет ≈5 МБ, качается при первом заходе).
/// Компонент, который показывает art(...), зовёт этот хук: он просит пакет и перерисовывает, когда файлы легли.
export function useArcaniaArt(): void {
  useMediaGroup(ART_BUNDLE)
}
