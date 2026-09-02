<script setup lang="ts">
/**
 * 配置中心：模力方舟账户授权
 *
 * 一次授权（登录 + 自动获取访问令牌），四步功能即可全部使用。
 */
import { Select, Loading, RefreshRight, SwitchButton } from '@element-plus/icons-vue'
import { useMoarkAccount } from '@/composables/useMoarkAccount'

import { computed } from 'vue'

const {
  loggedIn,
  hasApiKey,
  isReady,
  isConfigCenterOpen,
  isAuthorizing,
  quotaRemaining,
  quotaTotal,
  isLoadingQuota,
  refreshQuota,
  authorize,
  logout,
  closeConfigCenter,
} = useMoarkAccount()

// 令牌有效但登录 cookie 已失效：其它功能正常，仅语音合成需重新授权
const cookieExpired = computed(() => hasApiKey.value && !loggedIn.value)

// 是否成功取到额度数据
const hasQuota = computed(
  () => quotaRemaining.value !== null && quotaTotal.value !== null,
)

/** 剩余占比（0~100），用于额度条宽度 */
const quotaPercent = computed(() => {
  const remaining = quotaRemaining.value
  const total = quotaTotal.value
  if (remaining === null || !total) return 0
  return Math.min(100, Math.max(0, (remaining / total) * 100))
})

/** 剩余次数偏低时用警示色（少于 20%） */
const isQuotaLow = computed(() => hasQuota.value && quotaPercent.value < 20)
</script>

<template>
  <teleport to="body">
    <transition name="cc-fade">
      <div v-if="isConfigCenterOpen" class="cc-backdrop" @click.self="closeConfigCenter">
        <section class="cc-modal" role="dialog" aria-modal="true" aria-labelledby="cc-title">
          <button class="cc-close" type="button" aria-label="关闭" @click="closeConfigCenter">×</button>

          <div class="cc-hero">
            <div class="cc-badge" :class="{ ready: isReady }">
              <component :is="isAuthorizing ? Loading : Select" :class="{ spin: isAuthorizing }" />
            </div>
            <h2 id="cc-title" class="cc-title">配置中心</h2>
            <p class="cc-status" :class="{ ready: isReady }">
              {{ isReady ? '已授权 · 全部功能就绪' : '未授权 · 请授权登录' }}
            </p>
            <p v-if="cookieExpired" class="cc-warn">
              登录态已过期，语音合成需重新授权（其它功能不受影响）
            </p>
          </div>

          <!-- 已授权：展示今日免费调用额度 -->
          <div v-if="isReady" class="cc-quota">
            <div class="cc-quota-head">
              <span class="cc-quota-label">今日免费调用额度</span>
              <button
                class="cc-quota-refresh"
                type="button"
                :disabled="isLoadingQuota"
                title="刷新额度"
                aria-label="刷新额度"
                @click="refreshQuota"
              >
                <RefreshRight :class="{ spin: isLoadingQuota }" />
              </button>
            </div>

            <template v-if="hasQuota">
              <p class="cc-quota-num" :class="{ low: isQuotaLow }">
                <span class="cc-quota-remaining">{{ quotaRemaining }}</span>
                <span class="cc-quota-total">/ {{ quotaTotal }} 次</span>
              </p>
              <div class="cc-quota-bar">
                <div
                  class="cc-quota-fill"
                  :class="{ low: isQuotaLow }"
                  :style="{ width: `${quotaPercent}%` }"
                ></div>
              </div>
              <p v-if="isQuotaLow" class="cc-quota-tip">
                剩余次数不多，次日 0 点自动重置
              </p>
            </template>
            <p v-else class="cc-quota-empty">
              <template v-if="isLoadingQuota">正在获取额度…</template>
              <template v-else-if="cookieExpired">
                登录态已过期，重新授权后可查看额度
              </template>
              <template v-else>额度获取失败，请稍后刷新</template>
            </p>
          </div>

          <p class="cc-desc">
          <span class="cc-hl">免费授权登录，</span>
          <span>每天赠送 <span class="cc-hl">100次</span> 免费AI模型调用机会</span>
          </p>

          <div class="cc-actions" :class="{ row: isReady }">
            <template v-if="isReady">
              <button
                class="cc-btn cc-btn-accent"
                type="button"
                :disabled="isAuthorizing"
                @click="authorize"
              >
                <RefreshRight :class="{ spin: isAuthorizing }" />
                {{ isAuthorizing ? '授权中…' : '重新授权' }}
              </button>
              <button
                class="cc-btn cc-btn-danger"
                type="button"
                :disabled="isAuthorizing"
                @click="logout"
              >
                <SwitchButton />
                退出登录
              </button>
            </template>
            <button
              v-else
              class="cc-primary"
              type="button"
              :disabled="isAuthorizing"
              @click="authorize"
            >
              {{ isAuthorizing ? '授权中…' : '免费授权登录' }}
            </button>
          </div>

          <p class="cc-foot">
            授权登录后，即可解锁文案创作、语音克隆、字幕识别等AI能力
          </p>
        </section>
      </div>
    </transition>
  </teleport>
</template>

<style scoped>
.cc-backdrop {
  position: fixed;
  inset: 0;
  z-index: 30;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(15, 23, 42, 0.45);
  backdrop-filter: blur(3px);
}

.cc-modal {
  position: relative;
  width: min(92vw, 420px);
  padding: 40px 32px 24px;
  border-radius: 18px;
  background: linear-gradient(180deg, #ffffff 0%, #f7fafc 100%);
  border: 1px solid rgba(42, 111, 151, 0.12);
  box-shadow: 0 30px 80px rgba(15, 23, 42, 0.3);
  text-align: center;
}

.cc-close {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 30px;
  height: 30px;
  display: inline-grid;
  place-items: center;
  border: 0;
  border-radius: 8px;
  color: #94a3b8;
  background: transparent;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  transition: all 0.15s ease;
}

.cc-close:hover {
  color: #475569;
  background: #eef2f7;
}

.cc-hero {
  display: grid;
  justify-items: center;
  gap: 8px;
}

.cc-badge {
  width: 60px;
  height: 60px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: #ffffff;
  background: linear-gradient(135deg, #94a3b8 0%, #cbd5e1 100%);
  box-shadow: 0 10px 24px rgba(148, 163, 184, 0.4);
}

.cc-badge.ready {
  background: linear-gradient(135deg, #2a9d6f 0%, #3ec98a 100%);
  box-shadow: 0 10px 24px rgba(46, 157, 111, 0.38);
}

.cc-badge :deep(svg) {
  width: 30px;
  height: 30px;
}

.cc-badge :deep(svg.spin) {
  animation: cc-spin 0.9s linear infinite;
}

@keyframes cc-spin {
  to {
    transform: rotate(360deg);
  }
}

.cc-title {
  margin: 4px 0 0;
  color: #121924;
  font-size: 20px;
  font-weight: 800;
  letter-spacing: 0.5px;
}

.cc-status {
  margin: 0;
  padding: 3px 12px;
  border-radius: 999px;
  color: #e0563f;
  background: #fdece8;
  font-size: 13px;
  font-weight: 700;
}

.cc-status.ready {
  color: #2a9d6f;
  background: #e8f7ef;
}

.cc-warn {
  margin: 6px 0 0;
  color: #d9694f;
  font-size: 12px;
  line-height: 1.5;
}

/* ── 今日免费调用额度 ── */
.cc-quota {
  margin: 18px 0 4px;
  padding: 12px 14px;
  border: 1px solid #dbe7f1;
  border-radius: 12px;
  background: linear-gradient(180deg, #f7fbfe 0%, #eef5fb 100%);
  text-align: left;
}

.cc-quota-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.cc-quota-label {
  color: #4a5a6b;
  font-size: 12px;
  font-weight: 700;
}

.cc-quota-refresh {
  width: 24px;
  height: 24px;
  display: inline-grid;
  place-items: center;
  border: 0;
  border-radius: 6px;
  color: #6b8299;
  background: transparent;
  cursor: pointer;
  transition: all 0.15s ease;
}

.cc-quota-refresh:hover:not(:disabled) {
  color: #2a6f97;
  background: #e1edf6;
}

.cc-quota-refresh:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.cc-quota-refresh :deep(svg) {
  width: 14px;
  height: 14px;
}

.cc-quota-refresh :deep(svg.spin) {
  animation: cc-spin 0.9s linear infinite;
}

.cc-quota-num {
  margin: 6px 0 8px;
  display: flex;
  align-items: baseline;
  gap: 5px;
  color: #2a6f97;
}

/* 剩余数与总数保持同一字号，整体偏小 */
.cc-quota-remaining {
  font-size: 13px;
  font-weight: 700;
  line-height: 1.4;
  font-variant-numeric: tabular-nums;
}

.cc-quota-total {
  color: #8296a8;
  font-size: 13px;
  font-weight: 600;
}

.cc-quota-num.low {
  color: #d9694f;
}

.cc-quota-bar {
  height: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: #dde8f1;
}

.cc-quota-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #2a9d6f 0%, #3ec98a 100%);
  transition: width 0.3s ease;
}

.cc-quota-fill.low {
  background: linear-gradient(90deg, #d9694f 0%, #f0a58c 100%);
}

.cc-quota-tip {
  margin: 8px 0 0;
  color: #d9694f;
  font-size: 11px;
  line-height: 1.5;
}

.cc-quota-empty {
  margin: 8px 0 0;
  color: #94a3b8;
  font-size: 12px;
}

.cc-desc {
  margin: 20px 0 22px;
  color: #64748b;
  font-size: 13px;
  line-height: 1.8;
}

.cc-hl {
  color: #2a6f97;
  font-weight: 700;
}

.cc-actions {
  display: grid;
  gap: 10px;
}

/* 已授权：重新授权 / 退出登录 同行，各占一半 */
.cc-actions.row {
  grid-template-columns: 1fr 1fr;
}

.cc-primary {
  height: 44px;
  border: 0;
  border-radius: 10px;
  color: #ffffff;
  background: linear-gradient(135deg, #2a6f97 0%, #3c8c72 100%);
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.5px;
  cursor: pointer;
  box-shadow: 0 8px 20px rgba(42, 111, 151, 0.28);
  transition: transform 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease;
}

.cc-primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 12px 26px rgba(42, 111, 151, 0.34);
}

.cc-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* 已授权状态的一对等重按钮 */
.cc-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 42px;
  border: 1px solid transparent;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s ease;
}

.cc-btn :deep(svg) {
  width: 16px;
  height: 16px;
}

.cc-btn :deep(svg.spin) {
  animation: cc-spin 0.9s linear infinite;
}

.cc-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.cc-btn-accent {
  color: #2a6f97;
  background: #eef5fb;
  border-color: #d5e6f2;
}

.cc-btn-accent:hover:not(:disabled) {
  background: #e3eff8;
  border-color: #b9d5e8;
}

.cc-btn-danger {
  color: #d9694f;
  background: #fdf0ed;
  border-color: #f6d8d0;
}

.cc-btn-danger:hover:not(:disabled) {
  background: #fbe6e0;
  border-color: #f0c4b8;
}

.cc-foot {
  margin: 20px 0 0;
  color: #94a3b8;
  font-size: 12px;
  line-height: 1.6;
}

.cc-foot a {
  color: #2a6f97;
  font-weight: 700;
  text-decoration: none;
}

.cc-foot a:hover {
  text-decoration: underline;
}

.cc-fade-enter-active,
.cc-fade-leave-active {
  transition: opacity 0.18s ease;
}

.cc-fade-enter-from,
.cc-fade-leave-to {
  opacity: 0;
}
</style>
