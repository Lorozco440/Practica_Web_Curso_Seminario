// Copia de los datos de SQLite para dibujar la interfaz.
let enviando = false;
let datos = { juegos: [], personas: [], prestamos: [] };
const $ = (id) => document.getElementById(id);

function avisar(texto, error = false) {
  $('mensaje').textContent = texto;
  $('mensaje').classList.toggle('error', error);
}

// Fecha local: evita que la diferencia horaria cambie el día.
function hoy() {
  const fecha = new Date();
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
}

async function solicitar(ruta, contenido) {
  const respuesta = await fetch(ruta, contenido === undefined ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(contenido)
  });
  const resultado = await respuesta.json();
  if (!respuesta.ok) throw new Error(resultado.error || 'No se pudo completar la operación.');
  return resultado;
}

async function cargar() {
  try {
    datos = await solicitar('/api/datos');
    renderizar();
    return true;
  } catch {
    avisar('No se pudo conectar. Inicia el servidor con npm start y abre http://localhost:3000.', true);
    return false;
  }
}

async function guardar(ruta, contenido, mensaje) {
  if (enviando) return false;
  enviando = true;
  document.querySelectorAll('button').forEach((boton) => boton.disabled = true);
  try {
    datos = await solicitar(ruta, contenido);
    avisar(mensaje);
    return true;
  } catch (error) {
    avisar(error.message === 'Failed to fetch'
      ? 'No se pudo conectar con el servidor. Comprueba que siga encendido y recarga la página.'
      : error.message, true);
    return false;
  } finally {
    enviando = false;
    document.querySelectorAll('button').forEach((boton) => boton.disabled = false);
    renderizar();
  }
}

function prestamoActivo(juegoId) {
  return datos.prestamos.find((prestamo) => prestamo.juegoId === juegoId && !prestamo.devolucion);
}

// textContent muestra los textos escritos por el usuario de forma segura.
function celda(fila, texto) {
  const td = document.createElement('td');
  td.textContent = texto;
  fila.appendChild(td);
  return td;
}

function estado(fila, texto) {
  const etiqueta = document.createElement('span');
  etiqueta.className = `estado ${texto.toLowerCase()}`;
  etiqueta.textContent = texto;
  celda(fila, '').appendChild(etiqueta);
}

function vacio(tabla, texto, columnas) {
  const fila = document.createElement('tr');
  const td = celda(fila, texto);
  td.colSpan = columnas;
  td.className = 'vacio';
  tabla.appendChild(fila);
}

function llenarSelect(id, registros, etiqueta, textoInicial) {
  const select = $(id);
  const seleccionAnterior = select.value;
  select.replaceChildren(new Option(textoInicial, ''));
  registros.forEach((registro) => select.add(new Option(etiqueta(registro), registro.id)));
  if (registros.some((registro) => registro.id === seleccionAnterior)) select.value = seleccionAnterior;
}

function fechaLegible(fecha) {
  if (!fecha) return 'Pendiente';
  const [anio, mes, dia] = fecha.split('-');
  return `${dia}/${mes}/${anio}`;
}

function renderizar() {
  const disponibles = datos.juegos.filter((juego) => !prestamoActivo(juego.id));
  $('resumen').textContent = `${datos.juegos.length} juegos · ${disponibles.length} disponibles · ${datos.juegos.length - disponibles.length} prestados`;
  llenarSelect('juego', disponibles, (juego) => `${juego.titulo} (${juego.plataforma})`, 'Selecciona un juego');
  llenarSelect('persona', datos.personas, (persona) => persona.nombre, 'Selecciona una persona');
  $('prestar').disabled = !disponibles.length || !datos.personas.length;
  $('ayuda-prestamo').textContent = !datos.personas.length
    ? 'Registra una persona para poder prestar un juego.'
    : !disponibles.length ? 'Necesitas un juego disponible para realizar un préstamo.' : '';

  $('personas').replaceChildren();
  if (!datos.personas.length) {
    const li = document.createElement('li');
    li.textContent = 'No hay personas registradas.';
    $('personas').appendChild(li);
  }
  datos.personas.forEach((persona) => {
    const li = document.createElement('li');
    li.textContent = persona.nombre;
    $('personas').appendChild(li);
  });

  $('juegos').replaceChildren();
  if (!datos.juegos.length) vacio($('juegos'), 'Todavía no hay juegos. Registra el primero con el formulario.', 6);
  datos.juegos.forEach((juego) => {
    const prestamo = prestamoActivo(juego.id);
    const persona = prestamo && datos.personas.find((p) => p.id === prestamo.personaId);
    const fila = document.createElement('tr');
    celda(fila, juego.titulo);
    celda(fila, juego.plataforma);
    celda(fila, juego.genero);
    estado(fila, prestamo ? 'Prestado' : 'Disponible');
    celda(fila, persona ? persona.nombre : '—');
    const accion = celda(fila, prestamo ? '' : '—');
    if (prestamo) {
      const boton = document.createElement('button');
      boton.type = 'button';
      boton.textContent = 'Devolver';
      boton.setAttribute('aria-label', `Devolver ${juego.titulo}`);
      boton.addEventListener('click', () => devolver(prestamo.id));
      accion.appendChild(boton);
    }
    $('juegos').appendChild(fila);
  });

  $('historial').replaceChildren();
  if (!datos.prestamos.length) vacio($('historial'), 'Todavía no se han realizado préstamos.', 5);
  [...datos.prestamos].reverse().forEach((prestamo) => {
    const juego = datos.juegos.find((j) => j.id === prestamo.juegoId);
    const persona = datos.personas.find((p) => p.id === prestamo.personaId);
    const fila = document.createElement('tr');
    celda(fila, juego ? `${juego.titulo} (${juego.plataforma})` : 'Juego no encontrado');
    celda(fila, persona ? persona.nombre : 'Persona no encontrada');
    celda(fila, fechaLegible(prestamo.fecha));
    celda(fila, fechaLegible(prestamo.devolucion));
    estado(fila, prestamo.devolucion ? 'Devuelto' : 'Prestado');
    $('historial').appendChild(fila);
  });
}

$('form-juego').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const titulo = $('titulo').value.trim();
  const plataforma = $('plataforma').value.trim();
  const genero = $('genero').value.trim();
  if (!titulo || !plataforma || !genero) return avisar('Completa todos los datos del juego.', true);
  const juego = { titulo, plataforma, genero };
  if (await guardar('/api/juegos', juego, 'Juego registrado.')) {
    evento.target.reset();
    $('titulo').focus();
  }
});

$('form-persona').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const nombre = $('nombre').value.trim();
  if (!nombre) return avisar('Escribe el nombre de la persona.', true);
  if (datos.personas.some((persona) => persona.nombre.toLocaleLowerCase('es') === nombre.toLocaleLowerCase('es'))) {
    return avisar('Ya existe una persona con ese nombre. Añade un apellido o una referencia para distinguirla.', true);
  }
  const persona = { nombre };
  if (await guardar('/api/personas', persona, 'Persona registrada.')) {
    evento.target.reset();
    $('nombre').focus();
  }
});

$('form-prestamo').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const juegoId = $('juego').value;
  const personaId = $('persona').value;
  const fecha = $('fecha').value;
  if (!datos.juegos.some((juego) => juego.id === juegoId) || !datos.personas.some((persona) => persona.id === personaId) || !fecha) {
    return avisar('Selecciona un juego, una persona y una fecha.', true);
  }
  if (fecha > hoy()) return avisar('La fecha del préstamo no puede ser futura.', true);
  if (prestamoActivo(juegoId)) return avisar('Este juego ya está prestado.', true);
  // Impide registrar un préstamo anterior a la última devolución del mismo ejemplar.
  if (datos.prestamos.some((p) => p.juegoId === juegoId && p.devolucion && fecha < p.devolucion)) {
    return avisar('La fecha no puede ser anterior a la última devolución de este juego.', true);
  }
  const prestamo = { juegoId, personaId, fecha };
  if (await guardar('/api/prestamos', prestamo, 'Préstamo registrado.')) {
    evento.target.reset();
    $('fecha').value = hoy();
  }
});

async function devolver(id) {
  await guardar(`/api/prestamos/${id}/devolver`, {}, 'Devolución registrada. El juego vuelve a estar disponible.');
}

// Actualiza los datos al regresar desde otra pestaña.
window.addEventListener('focus', () => { if (!enviando) cargar(); });
$('fecha').value = hoy();
$('fecha').max = hoy();
cargar();
