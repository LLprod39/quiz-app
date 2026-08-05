const GUEST_DEVICE_KEY = 'quiz_guest_device'
const SCREEN_DEVICE_KEY = 'quiz_screen_device'

function randomToken() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')
}

function installationToken(key: string) {
  let value = localStorage.getItem(key)
  if (!value) {
    value = randomToken()
    localStorage.setItem(key, value)
  }
  return value
}

export const guestDeviceToken = () => installationToken(GUEST_DEVICE_KEY)
export const screenDeviceToken = () => installationToken(SCREEN_DEVICE_KEY)
