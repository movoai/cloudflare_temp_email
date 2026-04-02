<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { api } from '../../api'
import { useGlobalState } from '../../store'
import { parseWildcardDomainPool } from '../../utils/wildcard-domain'

const emit = defineEmits(['saved'])

const message = useMessage()
const { openSettings } = useGlobalState()

const loading = ref(false)
const form = reactive({
    wildcardDomainsText: '',
    activeWildcardDomains: [],
    retentionDays: 90,
})

const { t } = useI18n({
    messages: {
        en: {
            title: 'Cloudflare Wildcard Domains',
            description: 'Configure the wildcard root-domain pool, then quickly choose which domains are currently active.',
            wildcardDomains: 'Wildcard Domain Pool',
            wildcardDomainsPlaceholder: '*.mail.example.com\n*.mail.example.net',
            activeWildcardDomains: 'Active Wildcard Domains',
            activeWildcardDomainsPlaceholder: 'Select one or more active wildcard domains',
            retentionDays: 'Retention Days',
            retentionDaysTip: 'Concrete addresses stay receive-only and accept new mail for 90 days in this deployment.',
            receiveOnlyTip: 'Wildcard-created addresses are receive-only. Sending remains disabled for these addresses.',
            save: 'Save',
            reload: 'Reload',
            saveSuccess: 'Cloudflare wildcard settings saved',
            wildcardPoolRequired: 'Please configure at least one wildcard domain',
            activeWildcardRequired: 'Please select at least one active wildcard domain',
        },
        zh: {
            title: 'Cloudflare 泛域名配置',
            description: '先维护可用的泛域名池，再快速选择当前启用的几个主域名。',
            wildcardDomains: '泛域名池',
            wildcardDomainsPlaceholder: '*.mail.example.com\n*.mail.example.net',
            activeWildcardDomains: '当前启用的泛域名',
            activeWildcardDomainsPlaceholder: '请选择当前启用的泛域名',
            retentionDays: '有效期天数',
            retentionDaysTip: '当前部署中，具体地址为仅收信地址，并可在 90 天内继续接收新邮件。',
            receiveOnlyTip: '通过泛解析创建的地址仅支持收信，不支持发送邮件。',
            save: '保存',
            reload: '重新加载',
            saveSuccess: 'Cloudflare 泛域名配置已保存',
            wildcardPoolRequired: '请至少配置一个泛域名',
            activeWildcardRequired: '请至少选择一个启用中的泛域名',
        }
    }
})

const wildcardDomains = computed(() => parseWildcardDomainPool(form.wildcardDomainsText))
const wildcardDomainOptions = computed(() => wildcardDomains.value.map((rule) => ({
    label: rule,
    value: rule,
})))

watch(wildcardDomains, (rules) => {
    form.activeWildcardDomains = form.activeWildcardDomains.filter((rule) => rules.includes(rule))
})

const hydrate = async () => {
    loading.value = true
    try {
        const settings = await api.getCloudflareWildcardSettings()
        form.wildcardDomainsText = (settings.wildcardDomains || []).join('\n')
        form.activeWildcardDomains = [...(settings.activeWildcardDomains || [])]
        form.retentionDays = settings.retentionDays || 90
    } catch (error) {
        message.error(error.message || 'error')
    } finally {
        loading.value = false
    }
}

const save = async () => {
    const nextWildcardDomains = wildcardDomains.value
    if (nextWildcardDomains.length < 1) {
        message.error(t('wildcardPoolRequired'))
        return
    }
    if (form.activeWildcardDomains.length < 1) {
        message.error(t('activeWildcardRequired'))
        return
    }

    loading.value = true
    try {
        const response = await api.saveCloudflareWildcardSettings({
            wildcardDomains: nextWildcardDomains,
            activeWildcardDomains: form.activeWildcardDomains,
            retentionDays: form.retentionDays || 90,
        })
        form.wildcardDomainsText = (response.settings?.wildcardDomains || nextWildcardDomains).join('\n')
        form.activeWildcardDomains = [...(response.settings?.activeWildcardDomains || form.activeWildcardDomains)]
        form.retentionDays = response.settings?.retentionDays || form.retentionDays || 90

        const nextActiveDomains = [...(response.settings?.activeWildcardDomains || form.activeWildcardDomains)]
        openSettings.value.domains = nextActiveDomains.map((rule) => ({ label: rule, value: rule }))
        openSettings.value.defaultDomains = [...nextActiveDomains]
        openSettings.value.cloudflareWildcardDomains = [...(response.settings?.wildcardDomains || nextWildcardDomains)]
        openSettings.value.activeCloudflareWildcardDomains = nextActiveDomains
        openSettings.value.cloudflareAddressRetentionDays = response.settings?.retentionDays || 90

        message.success(t('saveSuccess'))
        emit('saved', response.settings)
    } catch (error) {
        message.error(error.message || 'error')
    } finally {
        loading.value = false
    }
}

onMounted(async () => {
    await hydrate()
})
</script>

<template>
    <n-card :title="t('title')" :bordered="false" embedded>
        <n-space vertical :size="16">
            <n-text depth="3">
                {{ t('description') }}
            </n-text>
            <n-alert type="info" :show-icon="false" :bordered="false">
                {{ t('receiveOnlyTip') }}
            </n-alert>
            <n-form :model="form" label-placement="top">
                <n-form-item-row :label="t('wildcardDomains')">
                    <n-input v-model:value="form.wildcardDomainsText" type="textarea" :autosize="{ minRows: 4 }"
                        :placeholder="t('wildcardDomainsPlaceholder')" />
                </n-form-item-row>
                <n-form-item-row :label="t('activeWildcardDomains')">
                    <n-select v-model:value="form.activeWildcardDomains" multiple filterable
                        :options="wildcardDomainOptions" :consistent-menu-width="false"
                        :placeholder="t('activeWildcardDomainsPlaceholder')" />
                </n-form-item-row>
                <n-form-item-row :label="t('retentionDays')">
                    <n-input-number v-model:value="form.retentionDays" :min="90" :max="90" :precision="0" disabled />
                    <n-text depth="3" style="display: block; margin-top: 8px;">
                        {{ t('retentionDaysTip') }}
                    </n-text>
                </n-form-item-row>
            </n-form>
            <n-flex justify="end">
                <n-button tertiary @click="hydrate" :loading="loading">
                    {{ t('reload') }}
                </n-button>
                <n-button type="primary" @click="save" :loading="loading">
                    {{ t('save') }}
                </n-button>
            </n-flex>
        </n-space>
    </n-card>
</template>
