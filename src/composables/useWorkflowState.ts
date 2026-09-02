import { ref } from 'vue'

const createdCopyText = ref('')

export function useWorkflowState() {
  return {
    createdCopyText
  }
}
