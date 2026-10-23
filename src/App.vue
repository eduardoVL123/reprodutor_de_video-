<script setup>
import { RouterView } from 'vue-router'
import VideoPlayerOverlay from '@/components/VideoPlayerOverlay.vue'
import NetworkStatus from '@/components/NetworkStatus.vue'
import ExitConfirm from '@/components/ExitConfirm.vue'
</script>

<template>
  <main class="w-full h-full bg-tv-bg text-tv-text relative">
    <RouterView />
    <VideoPlayerOverlay />
    <NetworkStatus />
    <ExitConfirm />
  </main>
</template>
