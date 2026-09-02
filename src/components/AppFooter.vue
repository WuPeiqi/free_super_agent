<script setup lang="ts">
import { ChatDotRound, User } from '@element-plus/icons-vue'
import { ElIcon } from 'element-plus'
</script>

<template>
  <footer class="app-footer">
    <span class="footer-author">
      使用文档
    </span>
    <span class="footer-separator">|</span>
    <a target="_blank" href="https://5x-class.feishu.cn/wiki/SEbcwBFO0iS98ekvBwHc0KTzndf">
       https://5x-class.feishu.cn/wiki/SEbcwBFO0iS98ekvBwHc0KTzndf
    </a>
  </footer>
</template>

<style scoped>
.app-footer {
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  overflow: hidden;
  padding: 0 12px;
  border-top: 1px solid #d9e0ea;
  color: #526175;
  background: #ffffff;
  font-size: 12px;
  line-height: 1;
  white-space: nowrap;
}

.footer-author {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.app-footer a {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: inherit;
  text-decoration: none;
}

.app-footer a:hover {
  color: #1e5f99;
}

.footer-separator {
  color: #b2bdca;
}

@media (max-width: 640px) {
  .app-footer {
    justify-content: flex-start;
    overflow-x: auto;
  }
}
</style>
