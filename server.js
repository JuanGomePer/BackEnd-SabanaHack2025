import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { initDB, obtenerConsecutivoDocumento, registrarAuditoria, generarCUFE } from './db.js';
import { v4 as uuidv4 } from 'uuid';

const app = express();
app.use(cors());
app.use(bodyParser.json());

const db = await initDB();

/* =========================== USUARIOS =========================== */

// ✅ Obtener todos los usuarios
app.get('/usuarios', async (req, res) => {
  const usuarios = await db.all('SELECT * FROM usuarios');
  res.json(usuarios);
});

// ✅ Obtener usuario por cédula
app.get('/usuarios/:cedula', async (req, res) => {
  const usuario = await db.get('SELECT * FROM usuarios WHERE cedula = ?', [req.params.cedula]);
  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json(usuario);
});

// ✅ Crear usuario
app.post('/usuarios', async (req, res) => {
  const { cedula, tipo_documento, nombre, telefono, correo } = req.body;
  if (!cedula || !nombre || !correo)
    return res.status(400).json({ error: 'Campos requeridos: cedula, nombre, correo' });

  try {
    await db.run(
      `INSERT INTO usuarios (cedula, tipo_documento, nombre, telefono, correo)
       VALUES (?, ?, ?, ?, ?)`,
      [cedula, tipo_documento || 'CC', nombre, telefono, correo]
    );
    res.json({ message: 'Usuario creado correctamente' });
  } catch (err) {
    res.status(400).json({ error: 'Error al crear usuario o ya existe' });
  }
});

// ✅ Actualizar usuario
app.put('/usuarios/:cedula', async (req, res) => {
  const { nombre, telefono, correo, estado } = req.body;
  const usuario = await db.get('SELECT * FROM usuarios WHERE cedula = ?', [req.params.cedula]);
  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

  await db.run(
    `UPDATE usuarios
     SET nombre=?, telefono=?, correo=?, estado=?
     WHERE cedula=?`,
    [
      nombre || usuario.nombre,
      telefono || usuario.telefono,
      correo || usuario.correo,
      estado || usuario.estado,
      req.params.cedula
    ]
  );

  await registrarAuditoria(db, 'usuarios', req.params.cedula, 'UPDATE', usuario, req.body);
  res.json({ message: 'Usuario actualizado correctamente' });
});

/* =========================== PUNTOS DE VENTA =========================== */

app.get('/puntos_venta', async (req, res) => {
  const puntos = await db.all('SELECT * FROM puntos_venta');
  res.json(puntos);
});

/* =========================== PRODUCTOS =========================== */

// ✅ Obtener todos los productos
app.get('/productos', async (req, res) => {
  const productos = await db.all('SELECT * FROM productos');
  res.json(productos);
});

// ✅ Crear producto
app.post('/productos', async (req, res) => {
  const { codigo, nombre, descripcion, categoria, precio } = req.body;
  if (!codigo || !nombre || !categoria || !precio)
    return res.status(400).json({ error: 'Campos requeridos: codigo, nombre, categoria, precio' });

  try {
    await db.run(
      `INSERT INTO productos (id, codigo, nombre, descripcion, categoria, precio)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [uuidv4(), codigo, nombre, descripcion, categoria, precio]
    );
    res.json({ message: 'Producto creado correctamente' });
  } catch (err) {
    res.status(400).json({ error: 'Error al crear producto o ya existe' });
  }
});

/* =========================== ÓRDENES =========================== */

// ✅ Obtener todas las órdenes
app.get('/ordenes', async (req, res) => {
  const ordenes = await db.all(`
    SELECT o.*, u.nombre AS nombre_usuario, p.nombre AS punto_venta
    FROM ordenes o
    JOIN usuarios u ON o.cedula = u.cedula
    JOIN puntos_venta p ON o.id_punto_venta = p.id
  `);
  res.json(ordenes);
});

// ✅ Obtener orden específica
app.get('/ordenes/:id', async (req, res) => {
  const orden = await db.get('SELECT * FROM ordenes WHERE id = ?', [req.params.id]);
  if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });

  const detalles = await db.all('SELECT * FROM detalle_ordenes WHERE id_orden = ?', [orden.id]);
  res.json({ ...orden, detalles });
});

// ✅ Crear orden con detalle y documento equivalente
app.post('/ordenes', async (req, res) => {
  const { cedula, id_punto_venta, metodo_pago, metodo_validacion, items } = req.body;

  if (!cedula || !id_punto_venta || !items || items.length === 0)
    return res.status(400).json({ error: 'Campos requeridos: cedula, id_punto_venta, items' });

  const usuario = await db.get('SELECT * FROM usuarios WHERE cedula = ?', [cedula]);
  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

  const subtotal = items.reduce((sum, i) => sum + i.cantidad * i.precio_unitario, 0);
  const impuestos = subtotal * 0.19;
  const total = subtotal + impuestos;
  const idOrden = uuidv4();

  await db.run(
    `INSERT INTO ordenes (id, numero, cedula, id_punto_venta, subtotal, impuestos, total, metodo_pago, metodo_validacion)
     VALUES (?, (SELECT IFNULL(MAX(numero), 0) + 1 FROM ordenes), ?, ?, ?, ?, ?, ?, ?)`,
    [idOrden, cedula, id_punto_venta, subtotal, impuestos, total, metodo_pago, metodo_validacion]
  );

  for (const item of items) {
    await db.run(
      `INSERT INTO detalle_ordenes (id, id_orden, id_producto, cantidad, precio_unitario, subtotal)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        uuidv4(),
        idOrden,
        item.id_producto,
        item.cantidad,
        item.precio_unitario,
        item.cantidad * item.precio_unitario
      ]
    );
  }

  // Crear documento equivalente (simulación factura electrónica)
  const numeroDoc = await obtenerConsecutivoDocumento(db);
  const cufe = generarCUFE(numeroDoc, new Date().toISOString(), total, '860012357-6');

  await db.run(
    `INSERT INTO documentos_equivalentes (id, id_orden, numero_documento, cufe, estado_envio)
     VALUES (?, ?, ?, ?, ?)`,
    [uuidv4(), idOrden, numeroDoc, cufe, 'PENDIENTE']
  );

  await registrarAuditoria(db, 'ordenes', idOrden, 'INSERT', {}, req.body, 'SISTEMA', cedula);

  res.json({
    message: 'Orden creada y documento equivalente generado',
    idOrden,
    numero_documento: numeroDoc,
    cufe
  });
});

// ✅ Cambiar estado de la orden
app.put('/ordenes/:id/estado', async (req, res) => {
  const { estado } = req.body;
  const validos = ['PENDIENTE', 'PREPARANDO', 'COMPLETADA', 'CANCELADA'];
  if (!validos.includes(estado))
    return res.status(400).json({ error: 'Estado no válido' });

  const orden = await db.get('SELECT * FROM ordenes WHERE id = ?', [req.params.id]);
  if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });

  await db.run('UPDATE ordenes SET estado=? WHERE id=?', [estado, req.params.id]);
  await registrarAuditoria(db, 'ordenes', req.params.id, 'UPDATE', orden, { estado });

  res.json({ message: `Orden actualizada a estado ${estado}` });
});

/* =========================== DOCUMENTOS EQUIVALENTES =========================== */

app.get('/documentos', async (req, res) => {
  const docs = await db.all('SELECT * FROM documentos_equivalentes');
  res.json(docs);
});

/* =========================== AUDITORÍA Y CONFIGURACIÓN =========================== */

app.get('/auditoria', async (req, res) => {
  const logs = await db.all('SELECT * FROM auditoria ORDER BY fecha_hora DESC LIMIT 100');
  res.json(logs);
});

app.get('/configuracion', async (req, res) => {
  const config = await db.all('SELECT * FROM configuracion_normativa WHERE activo = 1');
  res.json(config);
});

/* =========================== SERVIDOR =========================== */

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`✅ Backend iniciado en http://localhost:${PORT}`));
