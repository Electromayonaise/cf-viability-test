# cf-viability-test

Experimento de viabilidad para enviar soluciones a Codeforces desde una plataforma propia, de manera similar a como lo hace VJudge.

**Estado: funciona en entorno local. No es directamente deployable como web app sin cambios arquitecturales importantes.**

---

## ¿Qué hace este repo?

Permite que un usuario autenticado en Codeforces envíe soluciones desde una interfaz web propia:

```
Usuario escribe código en la app
        ↓
Presiona Submit
        ↓
El servidor lanza Chrome headless, restaura la sesión guardada,
llena el formulario de Codeforces y hace click en Submit
        ↓
La app obtiene el veredicto automáticamente
```

---

## Stack

- **Backend:** Node.js + Express
- **Automatización:** Playwright (conectado vía CDP a Chrome real del sistema)
- **Frontend:** HTML/CSS/JS vanilla con MathJax para renderizar enunciados
- **Sesiones:** AES-256-CBC cifrado en disco (`sessions/<handle>.json`)

---

## Setup

```bash
npm install
node server.js
# → http://localhost:3000
```

Requiere **Google Chrome instalado en el sistema** (no Chromium de Playwright).

---

## Cómo funciona la implementación actual

### Login

1. El usuario ingresa su handle y contraseña en la app.
2. El servidor lanza Chrome **visible** con `child_process.spawn()`.
3. Playwright se conecta al Chrome real via CDP (`chromium.connectOverCDP`), sin inyectar el runtime de automatización.
4. Se pre-llenan las credenciales. El usuario resuelve el Turnstile manualmente si aparece.
5. Al detectar login exitoso, se guardan las cookies cifradas en disco.

### Submit

1. El servidor lanza Chrome **headless** en un perfil temporal.
2. Restaura las cookies de sesión con `context.addCookies()`.
3. Navega a `/problemset/submit`, verifica que la sesión esté activa.
4. Llena el formulario (problema, lenguaje, código).
5. Espera a que el Turnstile pase automáticamente y hace click en `#singlePageSubmitButton`.
6. Extrae el ID de submission y hace polling al endpoint `/api/verdict/:id`.

### Por qué Chrome real y no Chromium de Playwright

La cookie `cf_clearance` que genera Cloudflare está **criptográficamente ligada al TLS fingerprint del browser que la generó**. Si el login se hace en Chrome real pero el submit se hace con el TLS de Node.js (axios), Cloudflare rechaza con 403. Al lanzar Chrome via `child_process` y conectarse vía CDP, todo ocurre dentro del mismo browser — mismo fingerprint, misma cookie válida.

---

## Lo que se intentó antes y por qué no funcionó

### 1. Requests HTTP directas (axios + cheerio)

Simular manualmente las requests de Codeforces.

**Resultado:** `403 Forbidden` — `cf-mitigated: challenge`

Cloudflare exige ejecución de JavaScript y fingerprint de navegador. Un cliente HTTP no puede cumplir ninguna de las dos.

---

### 2. Spoofing de headers

Añadir `User-Agent`, `Accept`, `sec-ch-ua`, etc. para simular un browser.

**Resultado:** `403 Forbidden` igual.

Cloudflare no se fía solo de los headers — analiza el fingerprint TLS de la conexión. Node.js tiene un fingerprint distinto al de Chrome y es detectado inmediatamente.

---

### 3. Form POST desde el frontend

Hacer el submit directamente desde el navegador del usuario con un `<form>`.

**Resultado:** Redirigía a la home de CF o mostraba "You should be registered".

El submit requiere `csrf_token`, `ftaa` y `bfaa` — tokens generados en la página de submit que no son accesibles desde otro origen (Same-Origin Policy).

---

### 4. Extracción de tokens con iframe

Cargar `/problemset/submit` en un iframe oculto y leer los tokens desde JS.

**Resultado:** `Blocked by Same-Origin Policy`

El navegador bloquea cualquier acceso al DOM de un iframe de otro dominio. No hay workaround desde el frontend.

---

### 5. Playwright / Puppeteer estándar

Automatizar un browser con Playwright para hacer login y submit.

**Resultado:** Loop infinito de Cloudflare Turnstile — "Verify you are human" una y otra vez.

Playwright inyecta `navigator.webdriver = true` y otras señales que Cloudflare detecta. El challenge nunca pasa.

---

### 6. Playwright con perfil persistente

Usar `chromium.launchPersistentContext("./profile")` para reutilizar cookies entre sesiones.

**Resultado:** Cloudflare seguía detectando automatización.

El problema no son las cookies, sino que el browser que Playwright lanza sigue siendo detectado como automatizado independientemente del perfil.

---

### 7. Login por backend con credenciales (modelo VJudge directo)

Hacer el login desde el servidor sin abrir ningún browser.

**Resultado:** `403 Forbidden` — el endpoint `/enter` también está protegido por Cloudflare.

Sin un browser real que ejecute el JS de Cloudflare y pase el Turnstile, no hay forma de obtener `cf_clearance`.

---

### Por qué fallan todos estos enfoques

La causa raíz es siempre la misma:

> **Cloudflare Managed Challenge** requiere un browser real que ejecute JavaScript, genere un fingerprint TLS legítimo, y pase el Turnstile. Solo un Chrome/Firefox real puede hacer esto.

---

## Limitaciones de la implementación actual

**Requiere Chrome instalado en el servidor.** No es una dependencia npm — es una aplicación del sistema. En contenedores o servicios cloud esto requiere configuración adicional.

**No escala horizontalmente.** Cada submit lanza un proceso de Chrome pesado. Con múltiples usuarios concurrentes, la memoria y CPU se disparan rápidamente.

**El login es manual.** El usuario tiene que resolver el Turnstile una vez. No se puede automatizar completamente porque el Turnstile en el login requiere intervención humana.

**Las sesiones expiran.** Las cookies de Codeforces duran semanas, no indefinidamente. Cuando expiran, el usuario necesita volver a loguearse manualmente.

**El Turnstile en el submit puede fallar.** En cada submit, Codeforces muestra un Turnstile nuevo. En headless, este Turnstile pasa automáticamente la mayoría de las veces porque el Chrome es real — pero no está garantizado al 100%.

**Solo funciona en Linux/macOS/Windows con Chrome.** La ruta del ejecutable de Chrome es diferente en cada OS y se detecta automáticamente, pero en entornos sin interfaz gráfica (servidores headless sin GPU) Chrome puede tener comportamientos distintos.

---

## ¿Es viable implementarlo en una plataforma web a futuro?

**Sí, pero con restricciones arquitecturales importantes.**

### Lo que sí es viable hoy

El modelo que funciona — login manual una vez + sesión persistente + submit automatizado — es fundamentalmente el mismo que usa VJudge. La diferencia es que VJudge probablemente gestiona pools de cuentas propias, no las credenciales de los usuarios.

Para una plataforma propia con usuarios reales, el camino más realista es:

**Opción A — Modelo tipo VJudge:** la plataforma mantiene una o varias cuentas propias de Codeforces. Los submits se envían desde esas cuentas. El login manual se hace una vez por cuenta y la sesión dura semanas. El veredicto se obtiene y se asocia al usuario real en la base de datos propia. **Ventaja:** un solo login manual para miles de submits. **Desventaja:** los submissions no aparecen en el perfil del usuario en Codeforces.

**Opción B — Credenciales del usuario:** cada usuario conecta su cuenta una vez (login manual + Turnstile), la sesión se guarda cifrada, y los submits aparecen en su perfil real. Es lo que implementa este repo. **Ventaja:** veredictos reales en el perfil del usuario. **Desventaja:** requiere que el usuario confíe su contraseña a la plataforma, y cada sesión expira independientemente.

**Opción C — Cliente local:** una extensión de browser o app de escritorio que corre en la máquina del usuario y usa su sesión nativa de Codeforces. No requiere credenciales, no tiene problemas con Cloudflare, y los submits salen del browser real del usuario. Es el modelo de cf-tool y Competitive Companion. **Desventaja:** requiere que el usuario instale algo.

### Lo que no es viable

Hacer un backend stateless que simplemente haga requests HTTP a Codeforces. Cloudflare lo bloquea de manera determinista. Eso no va a cambiar mientras Codeforces use Cloudflare Managed Challenge.

---

## Estructura del repo

```
├── server.js               # Express: endpoints de API
├── config/config.js        # Configuración (puerto, paths)
├── services/
│   ├── cfService.js        # Login, submit y polling via Chrome+CDP
│   └── problemService.js   # Fetch de enunciados via CF API
├── public/
│   ├── index.html
│   ├── app.js
│   └── style.css
└── sessions/               # Cookies cifradas por usuario (gitignored)
```

## API

| Endpoint | Descripción |
|---|---|
| `GET /api/problem/:id` | Enunciado del problema |
| `GET /api/languages` | Lenguajes disponibles |
| `POST /api/login` | Abre Chrome visible para login |
| `GET /api/session/:handle` | Verifica si hay sesión activa |
| `DELETE /api/session/:handle` | Elimina sesión |
| `POST /api/submit` | Envía solución |
| `GET /api/verdict/:submissionId` | Estado del veredicto |
