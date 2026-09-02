<script setup lang="ts">
import { Setting } from '@element-plus/icons-vue'
import { useMoarkAccount } from '@/composables/useMoarkAccount'
import ConfigCenterModal from '@/components/ConfigCenterModal.vue'

const { isReady, openConfigCenter } = useMoarkAccount()
</script>

<template>
  <header class="app-header">
    <div class="project-brand" aria-label="超级IP智能体（开源免费版）">
      <span class="brand-mark">IP</span>
      <div class="brand-copy">
        <div class="project-name">超级IP智能体（开源免费版 v1.0.0）</div>
      </div>
    </div>

    <div class="header-actions">
      <button
        class="config-center-button"
        :class="{ 'is-ready': isReady }"
        type="button"
        title="配置中心"
        @click="openConfigCenter"
      >
        <Setting class="config-center-icon" aria-hidden="true" />
        <span>配置中心</span>
        <span class="config-center-dot" :class="{ ok: isReady }"></span>
      </button>
    </div>

    <ConfigCenterModal />
  </header>
</template>

<style scoped>
.app-header {
  position: relative;
  height: 75px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 20px;
  border-top: 1px solid #ffffff;
  border-bottom: 1px solid #cfd9e6;
  background: linear-gradient(180deg, #ffffff 0%, #f3f7fb 100%);
  box-shadow: inset 0 -1px 0 rgba(255, 255, 255, 0.72), 0 2px 8px rgba(20, 32, 48, 0.05);
}

.header-actions {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.config-center-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 14px;
  border: 1px solid #c7d5e7;
  border-radius: 999px;
  color: #29435f;
  background: linear-gradient(180deg, #ffffff 0%, #eef5fb 100%);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(42, 74, 108, 0.08);
}

.config-center-button:hover {
  border-color: #2a6f97;
  color: #2a6f97;
}

.config-center-button.is-ready {
  border-color: #86d0a9;
  color: #2f7d55;
}

.config-center-icon {
  width: 16px;
  height: 16px;
}

.config-center-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #e6a23c;
}

.config-center-dot.ok {
  background: #2f9e63;
}

.project-brand {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 7px 16px 7px 8px;
  border: 1px solid rgba(42, 111, 151, 0.18);
  border-radius: 999px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(239, 246, 252, 0.88)),
    #ffffff;
  box-shadow: 0 8px 24px rgba(42, 74, 108, 0.1);
}

.brand-mark {
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 999px;
  color: #ffffff;
  background: linear-gradient(135deg, #2a6f97 0%, #3c8c72 100%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.32);
  font-size: 13px;
  font-weight: 900;
  letter-spacing: 0;
}

.brand-copy {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.project-name {
  min-width: 0;
  color: #121924;
  font-size: 18px;
  font-weight: 800;
  line-height: 1.15;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 640px) {
  .app-header {
    padding: 0 12px;
  }

  .project-brand {
    max-width: 100%;
    padding-right: 12px;
  }

  .brand-mark {
    width: 34px;
    height: 34px;
    font-size: 12px;
  }

  .project-name {
    font-size: 16px;
  }
}
</style>
