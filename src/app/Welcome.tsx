import { FolderShape } from "../features/ui/FolderShape";

export function Welcome({ onLogin, onRegister }: { onLogin: () => void; onRegister: () => void }) {
  return <main className="pl-welcome" aria-label="PLINE — начало работы">
    <div className="pl-welcome-composition">
      <h1 className="pl-wordmark">PLINE</h1>
      <div className="pl-welcome-actions">
        <div className="pl-hero-folder"><FolderShape /></div>
        <button className="primary-button" onClick={onLogin}>Войти</button>
        <button className="quiet-button" aria-label="Создать аккаунт" onClick={onRegister}>регистрация</button>
      </div>
    </div>
  </main>;
}
