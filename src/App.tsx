const tools = [
  { name: 'Production Calculator', blurb: 'Machines and inputs needed for a target output rate.' },
  { name: 'Recipe Browser', blurb: 'Search items, alternates and what they unlock.' },
  { name: 'Power Planner', blurb: 'Balance generators against your factory draw.' },
]

export default function App() {
  return (
    <main className="page">
      <header className="hero">
        <p className="eyebrow">FICSIT Inc. approved*</p>
        <h1>Satisfactory Tools</h1>
        <p className="lede">A small toolbox for planning factories. More coming soon.</p>
      </header>
      <section className="grid">
        {tools.map((t) => (
          <article key={t.name} className="card">
            <h2>{t.name}</h2>
            <p>{t.blurb}</p>
            <span className="badge">Coming soon</span>
          </article>
        ))}
      </section>
      <footer className="foot">*not actually approved</footer>
    </main>
  )
}
