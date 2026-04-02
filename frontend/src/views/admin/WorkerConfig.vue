<script setup>
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n'

import { api } from '../../api'
import CloudflareWildcardSettingsForm from '../../components/admin/CloudflareWildcardSettingsForm.vue'

const message = useMessage()
const { t } = useI18n({
    messages: {
        en: {
            snapshot: 'Worker Config Snapshot',
            snapshotTip: 'Cloudflare wildcard settings are editable above; the rest of the worker config remains read-only here.',
        },
        zh: {
            snapshot: 'Worker 配置快照',
            snapshotTip: '上方可直接编辑 Cloudflare 泛域名配置，其余 worker 配置在此保持只读展示。',
        }
    }
})

const settings = ref({})

const fetchData = async () => {
    try {
        const res = await api.fetch(`/admin/worker/configs`)
        Object.assign(settings.value, res)
    } catch (error) {
        message.error(error.message || "error");
    }
}

onMounted(async () => {
    await fetchData();
})
</script>

<template>
    <div class="worker-config-page">
        <div style="max-width: 900px; width: 100%;">
            <CloudflareWildcardSettingsForm @saved="fetchData" />
            <n-card :title="t('snapshot')" :bordered="false" embedded style="margin-top: 16px; overflow: auto;">
                <n-text depth="3">
                    {{ t('snapshotTip') }}
                </n-text>
                <pre>{{ JSON.stringify(settings, null, 2) }}</pre>
            </n-card>
        </div>
    </div>
</template>

<style scoped>
.worker-config-page {
    display: flex;
    text-align: left;
    justify-content: center;
    margin: 20px;
}
</style>
