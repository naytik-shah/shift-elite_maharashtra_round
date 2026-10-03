import Drop from './pages/Drop'
import Register from './pages/Register'
import { useSession } from './hooks/useSession'

export default function App() {
  const { session, setSession } = useSession()

  return (
    <main className="mx-auto min-h-screen max-w-md px-4 py-8">
      <header className="mb-6 flex items-center gap-2">
        <img src="/icon.svg" alt="" className="h-8 w-8 rounded-md" />
        <h1 className="text-2xl font-bold tracking-tight">Fair Drop</h1>
      </header>
      {session ? (
        <Drop session={session} onLeave={() => setSession(null)} />
      ) : (
        <Register onDone={setSession} />
      )}
    </main>
  )
}
