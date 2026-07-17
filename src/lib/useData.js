import { useEffect, useState } from 'react'

const cache = {}

export function useData(name) {
  const [data, setData] = useState(cache[name] ?? null)
  const [loading, setLoading] = useState(!cache[name])

  useEffect(() => {
    if (cache[name]) {
      setData(cache[name])
      setLoading(false)
      return
    }
    fetch(`${import.meta.env.BASE_URL}data/${name}.json`)
      .then((r) => r.json())
      .then((json) => {
        cache[name] = json
        setData(json)
        setLoading(false)
      })
  }, [name])

  return { data, loading }
}
