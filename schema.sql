PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS juegos (
  id TEXT PRIMARY KEY,
  titulo TEXT NOT NULL,
  plataforma TEXT NOT NULL,
  genero TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS personas (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  nombreClave TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS prestamos (
  id TEXT PRIMARY KEY,
  juegoId TEXT NOT NULL REFERENCES juegos(id),
  personaId TEXT NOT NULL REFERENCES personas(id),
  fecha TEXT NOT NULL,
  devolucion TEXT CHECK (devolucion IS NULL OR devolucion >= fecha)
);

-- Un ejemplar solo puede tener un préstamo activo.
CREATE UNIQUE INDEX IF NOT EXISTS un_prestamo_activo
ON prestamos(juegoId) WHERE devolucion IS NULL;
