# Flujo de trabajo — Pharma

Mismo flujo en `pharma-back` y `pharma-front`. Objetivo: que `main` sea siempre instalable
en una farmacia y que cada cambio se pueda rastrear de la historia al PR y a la prueba que lo cubre.

## 1. Ramas

| Rama | Sale de | Entra a | Para qué |
|---|---|---|---|
| `main` | — | — | Lo instalado en farmacias. Sólo recibe `release/*` y `hotfix/*`. Cada merge lleva **tag** `vX.Y.Z`. |
| `develop` | `main` | — | Integración. Siempre verde en CI. |
| `feature/<area>-<tema>` | `develop` | `develop` | Funcionalidad nueva. Ej. `feature/settings-cash`. |
| `fix/<area>-<tema>` | `develop` | `develop` | Corrección que puede esperar al siguiente release. |
| `refactor/…` `test/…` `docs/…` `chore/…` `ci/…` | `develop` | `develop` | Cambios sin efecto funcional. |
| `release/vX.Y.Z` | `develop` | `main` **y** `develop` | Congela alcance: sólo correcciones y versión. |
| `hotfix/vX.Y.Z` | `main` | `main` **y** `develop` | Urgencia en producción (una farmacia no puede cobrar). |

Nombres en minúsculas, con guiones, sin acentos. Una rama = un tema. Vida corta: días, no semanas.

### Ramas apiladas (features que dependen de otra)

Cuando B necesita el código de A (p. ej. `feature/settings-cash` usa `feature/settings-core`):

```bash
git switch develop && git pull
git switch -c feature/settings-core      # A
# … commits de A …
git switch -c feature/settings-cash      # B nace de A
# … commits de B …
git push -u origin feature/settings-core feature/settings-cash
```

- PR de A → `develop`. PR de B → **`feature/settings-core`** (así el diff muestra sólo B).
- Al fusionar A y borrar su rama, GitHub re-apunta el PR de B a `develop` solo.
- Se fusionan **en orden**. Cada PR debe pasar CI por sí mismo.

## 2. Commits

Formato (convencional + gitmoji), en minúsculas, en español, imperativo, **firmado**:

```bash
git commit -s -m "tipo: :gitmoji: qué cambia y para qué"
```

| tipo | gitmoji | uso |
|---|---|---|
| feat | `:sparkles:` | funcionalidad nueva |
| fix | `:bug:` | corrección |
| fix | `:lock:` | corrección de seguridad |
| refactor | `:recycle:` | sin cambio de comportamiento |
| perf | `:zap:` | rendimiento |
| test | `:white_check_mark:` | pruebas |
| docs | `:memo:` | documentación |
| chore | `:wrench:` | configuración, dependencias |
| feat (UI) | `:lipstick:` | interfaz y estilos |
| db | `:card_file_box:` | esquema y migraciones Prisma |
| ci | `:construction_worker:` | pipelines |

Reglas: un commit compila y pasa pruebas por sí mismo · el código y sus pruebas van en la misma
rama · migraciones en su propio commit `db:` · nada de "wip", "fix typo 3".

## 3. Base de datos (Prisma)

- **Prisma es la única vía hacia la base.** Nadie edita tablas ni escribe SQL de migración a mano.
- Cambiar `prisma/schema.prisma` → `npx prisma migrate dev --name <snake_case>` → commit `db:` con el
  schema **y** la carpeta `prisma/migrations/<fecha>_<nombre>` generada.
- Producción e instalaciones locales: `npx prisma migrate deploy` (nunca `migrate dev` ni `db push`).
- Migraciones **aditivas** en un release (tablas/columnas nuevas). Borrar o renombrar va en dos
  releases: primero dejar de usar, luego eliminar.

## 4. Pull requests

Título = mensaje del commit principal. Descripción con: **qué** · **por qué** · **cómo se probó** ·
**riesgos** · capturas si hay UI · migración sí/no.

Checklist antes de pedir revisión:

- [ ] `npm run lint:ci` y `npm run typecheck` (back) / `npx nuxi typecheck` y `npx nuxi build` (front)
- [ ] `npm run test:ci` en verde, sin bajar los umbrales de cobertura
- [ ] Probado a mano el flujo feliz y al menos un caso de error
- [ ] Docs del módulo actualizadas (`docs/*.md`) y ADR si hubo decisión de arquitectura
- [ ] Sin secretos, sin `console.log` de depuración

Fusión: **merge commit** para `release/*` → `main` (conserva la historia del release);
**squash** opcional para features de un solo commit.

## 5. Versionado y release

SemVer: `MAJOR` rompe instalación o API · `MINOR` funcionalidad · `PATCH` correcciones.

```bash
git switch develop && git pull
git switch -c release/v1.1.0
# sólo correcciones; actualizar versión en package.json
git commit -s -m "chore: :bookmark: versión 1.1.0"
# PR release/v1.1.0 → main; al fusionar:
git switch main && git pull && git tag -a v1.1.0 -m "v1.1.0" && git push origin v1.1.0
# y regresar el release a develop (PR release/v1.1.0 → develop)
```

Orden de despliegue: **backend (con `migrate deploy`) antes que frontend**.

## 6. Mayúsculas en nombres de archivo

Windows no distingue `Index.vue` de `index.vue`; Linux (CI, Docker, nube) sí. Los archivos de
`pages/` van **siempre en minúsculas**. Para renombrar sólo mayúsculas en Windows, en dos pasos:

```bash
git mv app/pages/Index.vue app/pages/_tmp.vue && git mv app/pages/_tmp.vue app/pages/index.vue
```
