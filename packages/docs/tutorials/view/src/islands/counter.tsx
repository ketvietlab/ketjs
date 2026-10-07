import { signal } from '@ketvietlab/ketjs-view'
import type { IslandFactory } from '@ketvietlab/ketjs-view'

type CounterProps = { initial: number }

const counter: IslandFactory<CounterProps> = (props) => {
  const count = signal(props.initial)
  return () => (
    <div class="counter">
      <span>Count: {count()}</span>
      <button type="button" onClick={() => count.set((value) => value + 1)}>
        Add one
      </button>
    </div>
  )
}

export default counter
