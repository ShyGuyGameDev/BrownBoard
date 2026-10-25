import { supabase } from './supabase'

const MAX_BYTES = 8 * 1024 * 1024

/** Uploads an image attached to a task and returns its public URL. Throws a readable error on failure. */
export async function uploadTaskImage(file: File, roomId: string): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Only image files can be attached.')
  if (file.size > MAX_BYTES) throw new Error('Images must be under 8 MB.')
  const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png'
  const path = `${roomId}/tasks/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage
    .from('board-assets')
    .upload(path, file, { contentType: file.type, cacheControl: '31536000' })
  if (error) throw new Error(`Image upload failed: ${error.message}`)
  return supabase.storage.from('board-assets').getPublicUrl(path).data.publicUrl
}
