import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const carpeta = fileURLToPath(new URL('.', import.meta.url));

function hoy() {
  const fecha = new Date();
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
}

function exigir(condicion, mensaje, status = 400) {
  if (!condicion) throw Object.assign(new Error(mensaje), { status });
}

function texto(valor, campo, maximo = 100) {
  exigir(typeof valor === 'string' && valor.trim().length > 0 && valor.trim().length <= maximo,
    `Completa ${campo} (máximo ${maximo} caracteres).`);
  return valor.trim();
}

async function leerJSON(req) {
  exigir(req.headers['content-type']?.split(';')[0] === 'application/json', 'Se esperaba JSON.', 415);
  let cuerpo = '';
  for await (const fragmento of req) {
    cuerpo += fragmento;
    exigir(Buffer.byteLength(cuerpo) <= 8192, 'Solicitud demasiado grande.', 413);
  }
  try {
    const contenido = JSON.parse(cuerpo);
    exigir(contenido && typeof contenido === 'object' && !Array.isArray(contenido), 'JSON no válido.');
    return contenido;
  } catch {
    throw Object.assign(new Error('JSON no válido.'), { status: 400 });
  }
}

// El servidor sirve la web y permite consultar o modificar la base de datos.
export function crearAplicacion(rutaDB = resolve(carpeta, 'videojuegos.db')) {
  const db = new DatabaseSync(rutaDB);
  db.exec(readFileSync(resolve(carpeta, 'schema.sql'), 'utf8'));

  function datos() {
    return {
      juegos: db.prepare('SELECT * FROM juegos ORDER BY rowid').all(),
      personas: db.prepare('SELECT id, nombre FROM personas ORDER BY rowid').all(),
      prestamos: db.prepare('SELECT * FROM prestamos ORDER BY rowid').all()
    };
  }

  function modificar(ruta, contenido) {
    if (ruta === '/api/juegos') {
      const titulo = texto(contenido.titulo, 'el título');
      const plataforma = texto(contenido.plataforma, 'la plataforma', 60);
      const genero = texto(contenido.genero, 'el género', 60);
      db.prepare('INSERT INTO juegos VALUES (?, ?, ?, ?)').run(randomUUID(), titulo, plataforma, genero);
    } else if (ruta === '/api/personas') {
      const nombre = texto(contenido.nombre, 'el nombre');
      const clave = nombre.toLocaleLowerCase('es');
      exigir(!db.prepare('SELECT id FROM personas WHERE nombreClave = ?').get(clave),
        'Ya existe una persona con ese nombre. Añade un apellido o referencia.', 409);
      db.prepare('INSERT INTO personas VALUES (?, ?, ?)').run(randomUUID(), nombre, clave);
    } else if (ruta === '/api/prestamos') {
      const juegoId = texto(contenido.juegoId, 'el juego');
      const personaId = texto(contenido.personaId, 'la persona');
      const fecha = contenido.fecha;
      exigir(typeof fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fecha)
        && Number(fecha.slice(0, 4)) > 0 && Number.isFinite(Date.parse(fecha))
        && new Date(fecha).toISOString().slice(0, 10) === fecha, 'Indica una fecha válida.');
      exigir(fecha <= hoy(), 'La fecha del préstamo no puede ser futura.');
      exigir(db.prepare('SELECT id FROM juegos WHERE id = ?').get(juegoId), 'El juego no existe.');
      exigir(db.prepare('SELECT id FROM personas WHERE id = ?').get(personaId), 'La persona no existe.');
      exigir(!db.prepare('SELECT id FROM prestamos WHERE juegoId = ? AND devolucion IS NULL').get(juegoId),
        'Este juego ya está prestado.', 409);
      exigir(!db.prepare('SELECT id FROM prestamos WHERE juegoId = ? AND devolucion > ?').get(juegoId, fecha),
        'La fecha no puede ser anterior a la última devolución de este juego.');
      db.prepare('INSERT INTO prestamos VALUES (?, ?, ?, ?, NULL)').run(randomUUID(), juegoId, personaId, fecha);
    } else if (/^\/api\/prestamos\/[^/]+\/devolver$/.test(ruta)) {
      const id = ruta.split('/')[3];
      const prestamo = db.prepare('SELECT * FROM prestamos WHERE id = ?').get(id);
      exigir(prestamo, 'El préstamo no existe.', 404);
      exigir(!prestamo.devolucion, 'Este préstamo ya se devolvió.', 409);
      exigir(hoy() >= prestamo.fecha, 'Revisa la fecha del sistema antes de registrar la devolución.');
      db.prepare('UPDATE prestamos SET devolucion = ? WHERE id = ?').run(hoy(), id);
    } else {
      exigir(false, 'Ruta no encontrada.', 404);
    }
  }

  async function manejar(req, res) {
    const responder = (status, contenido) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(contenido));
    };
    try {
      // Solo conexiones locales y solicitudes de nuestra propia página.
      const host = req.headers.host || '';
      exigir(/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host), 'Host no permitido.', 403);
      const ruta = new URL(req.url, `http://${host}`).pathname;
      if (req.method === 'GET' && ruta === '/api/datos') return responder(200, datos());
      if (req.method === 'POST' && ruta.startsWith('/api/')) {
        exigir(!req.headers.origin || req.headers.origin === `http://${host}`, 'Origen no permitido.', 403);
        const contenido = await leerJSON(req);
        // La transacción protege las comprobaciones y la escritura juntas.
        db.exec('BEGIN IMMEDIATE');
        try {
          modificar(ruta, contenido);
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
        return responder(200, datos());
      }
      const archivos = {
        '/': ['index.html', 'text/html; charset=utf-8'],
        '/index.html': ['index.html', 'text/html; charset=utf-8'],
        '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
        '/app.js': ['app.js', 'text/javascript; charset=utf-8']
      };
      if (req.method === 'GET' && archivos[ruta]) {
        const [archivo, tipo] = archivos[ruta];
        const contenido = readFileSync(resolve(carpeta, archivo));
        res.writeHead(200, { 'Content-Type': tipo, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        return res.end(contenido);
      }
      responder(404, { error: 'Ruta no encontrada.' });
    } catch (error) {
      if (!error.status) console.error(error);
      responder(error.status || 500, { error: error.status ? error.message : 'No se pudo completar la operación.' });
    }
  }
  return { manejar, cerrar: () => db.close() };
}

// Esta condición permite comprobar la aplicación sin iniciar un puerto de red.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = crearAplicacion();
  const servidor = createServer(app.manejar);
  const puerto = Number(process.env.PORT || 3000);
  servidor.on('error', (error) => {
    console.error(error.code === 'EADDRINUSE'
      ? `El puerto ${puerto} está ocupado. Prueba: PORT=3001 npm start`
      : error.message);
    app.cerrar();
    process.exitCode = 1;
  });
  servidor.listen(puerto, '127.0.0.1', () => {
    console.log(`Abre http://localhost:${puerto}`);
    console.log('Base de datos: ' + resolve(carpeta, 'videojuegos.db'));
    console.log('Para detener el servidor: Control + C');
  });
  const detener = () => servidor.close(() => { app.cerrar(); process.exit(0); });
  process.on('SIGINT', detener);
  process.on('SIGTERM', detener);
}
