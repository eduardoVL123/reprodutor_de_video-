<script setup>
import { RouterView } from 'vue-router'
import VideoPlayerOverlay from '@/components/VideoPlayerOverlay.vue'
</script>

<template>
  <main class="w-full h-full bg-tv-bg text-tv-text relative">
    <RouterView />
    <VideoPlayerOverlay />
  </main>
</template>
