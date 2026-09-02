<script setup lang="ts">
import { useLipSyncDedicated } from '@/composables/lip-sync-dedicated/useLipSyncDedicated'

const { config } = useLipSyncDedicated()
</script>

<template>
  <div class="dedicated-config-form">
    <div class="config-tip">
      <p class="config-tip-lead">
        近期对口型模型已<span class="highlight-red">无法免费白嫖</span>，如需使用，请任选一种方式自行部署独享算力：
      </p>
      <ol class="config-tip-list">
        <li>本地部署模型，电脑显存推荐 <strong>8G</strong> 及以上（永久免费）</li>
        <li>租云主机部署模型，费用约 <span class="highlight-red">¥3/小时</span></li>
      </ol>
      <p class="config-tip-foot">
        部署教程详见：<a href="https://5x-class.feishu.cn/wiki/AjBXwM1zIidNKTkkFGocqEqWnLg" target="_blank" rel="noreferrer">独享算力部署指南</a>
      </p>
    </div>
    <label class="config-field">
      <span>地址</span>
      <input
        v-model="config.baseUrl"
        type="text"
        placeholder="例如：http://127.0.0.1:8383"
      />
    </label>
  </div>
</template>

<style scoped>
.dedicated-config-form {
  display: grid;
  gap: 12px;
}

.config-tip {
  margin: 0;
  padding: 10px 12px;
  border: 1px solid #e3ebf3;
  border-radius: 8px;
  background: #f7fafc;
  color: #60728a;
  font-size: 12px;
  line-height: 1.6;
}

.config-tip-lead {
  margin: 0;
}

.config-tip-list {
  margin: 8px 0;
  padding-left: 20px;
  display: grid;
  gap: 4px;
  color: #334155;
}

.config-tip-list strong {
  color: #172033;
}

.config-tip-foot {
  margin: 0;
}

.config-tip a {
  color: #1d6fad;
  font-weight: 700;
  text-decoration: underline;
}

.config-tip a:hover {
  color: #155a8a;
}

.config-tip .highlight-red {
  color: #e53e3e;
  font-weight: 700;
}

.config-field {
  display: grid;
  gap: 6px;
}

.config-field > span {
  color: #334155;
  font-size: 12px;
  font-weight: 700;
}

.config-field input,
.config-field select {
  width: 100%;
  height: 36px;
  padding: 0 10px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  color: #172033;
  background: #ffffff;
  font-size: 13px;
  outline: none;
}

.config-field input:focus,
.config-field select:focus {
  border-color: #2a6f97;
  box-shadow: 0 0 0 3px rgba(42, 111, 151, 0.12);
}
</style>
