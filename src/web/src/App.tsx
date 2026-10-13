import { DeckConsole } from './components/DeckConsole'
import { Fluent2Mockups } from './components/mockups/Fluent2Mockups'
import { FluentMockups } from './components/mockups/FluentMockups'
import { HomeConsole } from './components/HomeConsole'
import { useRoute } from './hooks/useRoute'

export default function App() {
  const route = useRoute()
  if (route.view === 'mockups') return <FluentMockups concept={route.concept} />
  if (route.view === 'fluent2-mockups') return <Fluent2Mockups />
  return route.view === 'deck' ? <DeckConsole key={route.deckId} deckId={route.deckId} slide={route.slide} /> : <HomeConsole />
}
