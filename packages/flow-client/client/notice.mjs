// One transient result at a time; repeated operations renew the dismissal timer.
export function createTransientNotice(
  setValue,
  { delay = 4000, schedule = setTimeout, cancel = clearTimeout } = {},
) {
  let timer,
    message = '',
    paused = false
  const stop = () => {
    if (timer !== undefined) cancel(timer)
    timer = undefined
  }
  const clear = () => {
    stop()
    message = ''
    paused = false
    setValue('')
  }
  const resume = () => {
    stop()
    paused = false
    if (message) timer = schedule(clear, delay)
  }
  return {
    show(value) {
      stop()
      message = value
      setValue(value)
      if (!paused && value) timer = schedule(clear, delay)
    },
    clear,
    pause() {
      paused = true
      stop()
    },
    resume,
    dispose: stop,
  }
}
