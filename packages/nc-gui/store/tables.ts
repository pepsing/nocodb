import { acceptHMRUpdate, defineStore } from 'pinia'
import { ContentType, type TableType } from 'nocodb-sdk'
import type { ProjectFolderType, SidebarTableNode } from '~/lib/types'
import { DlgTableCreate } from '#components'

export const useTablesStore = defineStore('tablesStore', () => {
  const { includeM2M, ncNavigateTo } = useGlobal()
  const { api } = useApi()
  const { $e, $api } = useNuxtApp()
  const { refreshCommandPalette } = useCommandPalette()

  const router = useRouter()
  const route = router.currentRoute

  const baseTables = ref<Map<string, SidebarTableNode[]>>(new Map())
  const baseFolders = ref<Map<string, ProjectFolderType[]>>(new Map())
  const basesStore = useBases()
  // const baseStore = useBase()

  const workspaceStore = useWorkspace()

  const activeTableId = computed(() => route.value.params.viewId as string | undefined)

  const activeTables = computed(() => {
    if (!basesStore) return []

    const baseId = basesStore.activeProjectId
    if (!baseId) return []

    const tables = baseTables.value.get(baseId!)

    if (!tables) return []

    const openedProjectBasesMap = basesStore.openedProjectBasesMap

    return tables.filter((t) => !t.source_id || openedProjectBasesMap.get(t.source_id)?.enabled)
  })

  const activeTable = computed(() => {
    if (!basesStore) return

    const baseId = basesStore.activeProjectId
    if (!baseId) return

    const tables = baseTables.value.get(baseId!)

    if (!tables) return

    return activeTables.value.find((t) => t.id === activeTableId.value)
  })

  const loadProjectTables = async (baseId: string, force = false) => {
    if (!force && baseTables.value.get(baseId)) {
      return
    }

    const existingTables = baseTables.value.get(baseId)
    if (existingTables && !force) {
      return
    }

    const tables = await api.dbTable.list(baseId, {
      includeM2M: includeM2M.value,
    })

    await loadProjectFolders(baseId, force)

    tables.list?.forEach((t) => {
      let meta = t.meta
      if (typeof meta === 'string') {
        try {
          meta = JSON.parse(meta)
        } catch (e) {
          console.error(e)
        }
      }

      if (!meta) meta = {}

      t.meta = meta
    })

    baseTables.value.set(baseId, tables.list || [])
  }

  const loadProjectFolders = async (baseId: string, force = false) => {
    if (!force && baseFolders.value.get(baseId)) {
      return
    }

    const folders = await api.request<{ list: ProjectFolderType[] }, any>({
      path: `/api/v1/db/meta/projects/${baseId}/folders`,
      method: 'GET',
      format: 'json',
    })

    baseFolders.value.set(baseId, folders.list || [])
  }

  const createProjectFolder = async ({
    baseId,
    sourceId,
    parentId,
    title,
  }: {
    baseId: string
    sourceId?: string
    parentId?: string | null
    title?: string
  }) => {
    const folder = await api.request<ProjectFolderType, any>({
      path: `/api/v1/db/meta/projects/${baseId}/folders`,
      method: 'POST',
      type: ContentType.Json,
      format: 'json',
      body: {
        title: title || 'New folder',
        source_id: sourceId,
        fk_parent_id: parentId ?? null,
      },
    })

    await loadProjectFolders(baseId, true)
    refreshCommandPalette()

    return folder
  }

  const updateProjectFolder = async ({
    baseId,
    folderId,
    title,
    parentId,
  }: {
    baseId: string
    folderId: string
    title?: string
    parentId?: string | null
  }) => {
    const body: Partial<ProjectFolderType> = {}
    if (typeof title === 'string') body.title = title
    if (parentId !== undefined) body.fk_parent_id = parentId

    const folder = await api.request<ProjectFolderType, any>({
      path: `/api/v1/db/meta/projects/${baseId}/folders/${folderId}`,
      method: 'PATCH',
      type: ContentType.Json,
      format: 'json',
      body,
    })

    await loadProjectFolders(baseId, true)
    refreshCommandPalette()

    return folder
  }

  const deleteProjectFolder = async ({ baseId, folderId }: { baseId: string; folderId: string }) => {
    await api.request<void, any>({
      path: `/api/v1/db/meta/projects/${baseId}/folders/${folderId}`,
      method: 'DELETE',
      format: 'json',
    })

    await loadProjectFolders(baseId, true)
    refreshCommandPalette()
  }

  const moveTableToFolder = async ({
    baseId,
    tableId,
    folderId,
  }: {
    baseId: string
    tableId: string
    folderId?: string | null
  }) => {
    const table = baseTables.value.get(baseId)?.find((t) => t.id === tableId)
    if (table) table.fk_folder_id = folderId ?? null

    await api.dbTable.update(tableId, {
      base_id: baseId,
      fk_folder_id: folderId ?? null,
    })

    await loadProjectTables(baseId, true)
    refreshCommandPalette()
  }

  const addTable = (baseId: string, table: TableType) => {
    const tables = baseTables.value.get(baseId)
    if (!tables) return

    tables.push(table)
  }

  const navigateToTable = async ({
    baseId,
    tableId,
    viewTitle,
    workspaceId,
  }: {
    baseId?: string
    tableId: string
    viewTitle?: string
    workspaceId?: string
  }) => {
    const workspaceIdOrType = workspaceId ?? workspaceStore.activeWorkspaceId
    const baseIdOrBaseId = baseId ?? basesStore.activeProjectId

    let query

    // Retain query params only when navigating from one table page to another.
    // Note: `viewId` refers to `tableId` in this context.
    if (route.value?.params?.viewId && tableId) {
      query = route.value.query
    }

    ncNavigateTo({
      workspaceId: workspaceIdOrType,
      baseId: baseIdOrBaseId,
      tableId,
      viewId: viewTitle,
      query,
    })
  }

  const openTable = async (table: TableType, replace = false, query?: any) => {
    if (!table.base_id) return

    const bases = basesStore.bases
    const workspaceId = workspaceStore.activeWorkspaceId

    let base = bases.get(table.base_id)
    if (!base) {
      await basesStore.loadProject(table.base_id)
      await loadProjectTables(table.base_id)

      base = bases.get(table.base_id)
      if (!base) throw new Error('Base not found')
    }

    const { getMeta } = useMetas()

    await getMeta(table.base_id!, table.id as string)

    // const typeOrId = (route.value.params.typeOrId as string) || 'nc'

    let workspaceIdOrType = workspaceId

    if (['nc', 'base'].includes(route.value.params.typeOrId as string)) {
      workspaceIdOrType = route.value.params.typeOrId as string
    }

    let baseIdOrBaseId = base.id

    if (['base'].includes(route.value.params.typeOrId as string)) {
      baseIdOrBaseId = route.value.params.baseId as string
    }

    ncNavigateTo({
      workspaceId: workspaceIdOrType,
      baseId: baseIdOrBaseId,
      tableId: table?.id,
      query,
      replace,
    })
  }

  const updateTable = async (table: TableType) => {
    if (!table) return

    try {
      await $api.internal.postOperation(
        table.fk_workspace_id!,
        table.base_id!,
        {
          operation: 'tableUpdate',
          tableId: table.id as string,
        },
        {
          table_name: table.table_name,
          title: table.title,
        },
      )

      await loadProjectTables(table.base_id!, true)

      // update metas
      const newMeta = await $api.internal.getOperation(table.fk_workspace_id!, table.base_id!, {
        operation: 'tableGet',
        tableId: table.id as string,
      })
      baseTables.value.set(
        table.base_id!,
        baseTables.value.get(table.base_id!)!.map((t) => (t.id === table.id ? { ...t, ...newMeta } : t)),
      )

      // updateTab({ id: tableMeta.id }, { title: newMeta.title })

      refreshCommandPalette()

      $e('a:table:rename')
    } catch (e: any) {
      message.error(await extractSdkResponseErrorMsg(e))
    }
  }

  const loadTableMeta = async (tableId: string) => {
    try {
      const meta = await $api.internal.getOperation(workspaceStore.activeWorkspaceId!, basesStore.activeProjectId!, {
        operation: 'tableGet',
        tableId,
      })
      baseTables.value.set(
        meta.base_id!,
        baseTables.value.get(meta.base_id!)!.map((t) => (t.id === tableId ? { ...t, ...meta } : t)),
      )

      return meta
    } catch (e: any) {
      return null
    }
  }

  const tableUrl = ({ table, completeUrl, isSharedBase }: { table: TableType; completeUrl: boolean; isSharedBase?: boolean }) => {
    let base
    if (!isSharedBase) {
      base = basesStore.bases.get(table.base_id!)
      if (!base) return
    }

    const nuxtPageName = 'index-typeOrId-baseId-index-index-viewId-viewTitle'

    const url = router.resolve({
      name: nuxtPageName,
      params: isSharedBase
        ? {
            typeOrId: route.value.params.typeOrId,
            baseId: route.value.params.baseId,
            viewId: route.value.params.viewId,
          }
        : {
            typeOrId: workspaceStore.activeWorkspaceId,
            baseId: base?.id,
            viewId: table.id,
          },
    })

    if (completeUrl) return `${window.location.origin}/${url.href}`

    return url.href
  }

  const reloadTableMeta = async (tableId: string, baseId?: string) => {
    const { getMeta } = useMetas()
    const _baseId = baseId ?? activeTable.value?.base_id ?? basesStore.activeProjectId

    await getMeta(_baseId!, tableId, true)
  }

  function openTableCreateDialog({
    baseId,
    sourceId,
    onCloseCallback,
    showSourceSelector = true,
  }: {
    baseId?: string
    sourceId?: string
    onCloseCallback?: () => void
    showSourceSelector?: boolean
  }) {
    if (!sourceId || !baseId) return

    const isCreateTableOpen = ref(true)

    const { close } = useDialog(DlgTableCreate, {
      'modelValue': isCreateTableOpen,
      sourceId,
      'baseId': baseId,
      'showSourceSelector': showSourceSelector,
      'onCreate': closeDialog,
      'onUpdate:modelValue': () => closeDialog(),
    })

    function closeDialog(table?: TableType) {
      isCreateTableOpen.value = false

      if (!table) return

      onCloseCallback?.()

      setTimeout(() => {
        const newTableDom = document.querySelector(`[data-table-id="${table.id}"]`)
        if (!newTableDom) return

        // Scroll to the table node
        newTableDom?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }, 1000)

      close(1000)
    }
  }

  return {
    baseTables,
    baseFolders,
    loadProjectTables,
    loadProjectFolders,
    createProjectFolder,
    updateProjectFolder,
    deleteProjectFolder,
    moveTableToFolder,
    addTable,
    activeTable,
    activeTables,
    openTable,
    updateTable,
    activeTableId,
    navigateToTable,
    tableUrl,
    reloadTableMeta,
    loadTableMeta,
    openTableCreateDialog,
  }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useTablesStore as any, import.meta.hot))
}
