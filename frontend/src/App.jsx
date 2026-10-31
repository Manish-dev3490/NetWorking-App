export default function App() {
  return (
    <main className="app-shell">
      <section className="shell-message" aria-labelledby="shell-title">
        <p className="app-name">Social App</p>
        <h1 id="shell-title">Application shell is running.</h1>
        <p className="shell-description">
          The project foundation is ready. Social features will be added in the
          next development steps.
        </p>
        <p className="shell-status">
          <span className="status-dot" aria-hidden="true" />
          Frontend ready
        </p>
      </section>
    </main>
  );
}
