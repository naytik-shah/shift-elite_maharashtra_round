import { useEffect, useState } from 'react'

export type RouteName = 'explore' | 'event' | 'entries' | 'tickets' | 'account'
export interface Route { name: RouteName; id?: string }

function parse(): Route {
  const [a, b] = location.hash.replace(/^#\/?/, '').split('/')
  if (a === 'event' && b) return { name: 'event', id: decodeURIComponent(b) }
  if (a === 'entries' || a === 'tickets' || a === 'account') return { name: a }
  return { name: 'explore' }
}

// Hash routes work on any static host with no rewrite rules.
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(parse)
  useEffect(() => {
    const on = () => { setRoute(parse()); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return route
}

export const href = (name: RouteName, id?: string) =>
  name === 'explore' ? '#/' : name === 'event' ? `#/event/${encodeURIComponent(id ?? '')}` : `#/${name}`
export const go = (name: RouteName, id?: string) => { location.hash = href(name, id) }
