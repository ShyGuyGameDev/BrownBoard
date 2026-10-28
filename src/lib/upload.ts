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

const AVATAR_PX = 256

/** Centre-crops a picture to a square and shrinks it, so any photo makes a small avatar. */
async function squareAvatar(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("That picture couldn't be read. Try a PNG or JPG.")
  })
  const side = Math.min(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = AVATAR_PX
  canvas
    .getContext('2d')!
    .drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      AVATAR_PX,
      AVATAR_PX,
    )
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/webp', 0.9),
  )
  if (!blob) throw new Error("That picture couldn't be processed. Try another one.")
  return blob
}

/** Uploads a profile picture to avatars/<userId>/ and returns its public URL. */
export async function uploadAvatar(file: File, userId: string): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.')
  if (file.size > MAX_BYTES) throw new Error('Pictures must be under 8 MB.')
  const blob = await squareAvatar(file)
  const type = blob.type || 'image/png'
  const path = `${userId}/${crypto.randomUUID()}.${type === 'image/webp' ? 'webp' : 'png'}`
  const { error } = await supabase.storage
    .from('avatars')
    .upload(path, blob, { contentType: type, cacheControl: '31536000' })
  if (error) throw new Error(`Picture upload failed: ${error.message}`)
  return supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl
}

/** Removes your old pictures, keeping `keepUrl`. Best effort. */
export async function removeOldAvatars(userId: string, keepUrl: string | null) {
  const bucket = supabase.storage.from('avatars')
  const { data } = await bucket.list(userId, { limit: 100 })
  const old = (data ?? [])
    .filter((f) => f.id && !keepUrl?.endsWith(`/${userId}/${f.name}`))
    .map((f) => `${userId}/${f.name}`)
  if (old.length) await bucket.remove(old)
}
