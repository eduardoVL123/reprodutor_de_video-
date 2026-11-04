import { watch } from 'vue'
import { useParentalStore } from '@/stores/parentalStore'
import { useProfileStore } from '@/stores/profileStore'
import { useCatalogStore } from '@/stores/catalogStore'

const SECTIONS = ['live', 'vod', 'series']

/**
 * Liga o controle parental ao catálogo: ao trocar de perfil, mudar uma categoria ou desbloquear com PIN, recalcula o
 * que fica fora de "Todos", Início, busca e zapping. Uma lista nova já chega filtrada (setHiddenResolver).
 * @param {() => void} [onChange] chamado depois de aplicar (o Início recarrega as fileiras)
 */
export function useParentalFilter(onChange) {
  const parental = useParentalStore()
  const profiles = useProfileStore()
  const catalog = useCatalogStore()

  catalog.setHiddenResolver((section, categories) => parental.blockedIds(section, categories))
  watch(() => profiles.activeProfileId, (id) => parental.load(id), { immediate: true })
  watch(
    () => [parental.settings, parental.unlocked],
    async () => {
      await Promise.all(SECTIONS.map((s) => catalog.setHidden(s, parental.blockedIds(s, catalog.categories[s]))))
      if (onChange) onChange()
    },
  )
}
