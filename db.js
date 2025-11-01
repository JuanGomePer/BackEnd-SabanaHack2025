import dotenv from 'dotenv';
import pg from 'pg';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
dotenv.config();

const { Pool } = pg;

// Si hay URL de Railway, usa PostgreSQL
const usePostgres = !!process.env.DATABASE_URL;

// Inicializa la base de datos con cumplimiento normativo
export async function initDB() {
  let db;

  if (usePostgres) {
    console.log('🚀 Conectando a PostgreSQL en Railway...');

    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false } // Requerido por Railway
    });

    // Crea un adaptador mínimo para usar pool con misma API que sqlite
    db = {
      run: async (query, params = []) => {
        await pool.query(query, params);
      },
      get: async (query, params = []) => {
        const result = await pool.query(query, params);
        return result.rows[0];
      },
      all: async (query, params = []) => {
        const result = await pool.query(query, params);
        return result.rows;
      },
      exec: async (query) => {
        await pool.query(query);
      },
      pool
    };

  } else {
    console.log('💾 Usando base de datos SQLite local (modo desarrollo)...');
    db = await open({
      filename: './data.db',
      driver: sqlite3.Database
    });
  }

  // ========================
  // ======= TABLAS =========
  // ========================

  await db.exec(`
    CREATE TABLE IF NOT EXISTS usuarios (
      cedula TEXT PRIMARY KEY,
      tipo_documento TEXT NOT NULL DEFAULT 'CC',
      nombre TEXT NOT NULL,
      telefono TEXT,
      correo TEXT NOT NULL,
      codigo_qr TEXT UNIQUE,
      fecha_registro TEXT DEFAULT (CURRENT_TIMESTAMP),
      validacion_legal INTEGER DEFAULT 0,
      fecha_validacion_legal TEXT,
      terminos_aceptados INTEGER DEFAULT 0,
      fecha_aceptacion_terminos TEXT,
      estado TEXT DEFAULT 'ACTIVO'
    );
  `);

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_usuarios_qr ON usuarios(codigo_qr);
    CREATE INDEX IF NOT EXISTS idx_usuarios_correo ON usuarios(correo);
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS puntos_venta (
      id TEXT PRIMARY KEY,
      codigo TEXT UNIQUE NOT NULL,
      nombre TEXT NOT NULL,
      tipo_servicio TEXT NOT NULL,
      ubicacion TEXT NOT NULL,
      estado TEXT DEFAULT 'ACTIVO',
      fecha_creacion TEXT DEFAULT (CURRENT_TIMESTAMP)
    );
  `);

  await db.exec(`
    INSERT INTO puntos_venta (id, codigo, nombre, tipo_servicio, ubicacion)
    VALUES
    ('pv-1', 'PV-CC-01', 'Punto Café Zona Central', 'CAFETERIA', 'Campus Central'),
    ('pv-2', 'PV-CC-02', 'Punto Cipreses', 'CAFETERIA', 'Campus Central'),
    ('pv-3', 'PV-CC-03', 'Café de La Bolsa', 'CAFETERIA', 'Campus Central')
    ON CONFLICT DO NOTHING;
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS productos (
      id TEXT PRIMARY KEY,
      codigo TEXT UNIQUE NOT NULL,
      nombre TEXT NOT NULL,
      descripcion TEXT,
      categoria TEXT NOT NULL,
      precio REAL NOT NULL,
      disponible INTEGER DEFAULT 1,
      fecha_creacion TEXT DEFAULT (CURRENT_TIMESTAMP)
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS ordenes (
      id TEXT PRIMARY KEY,
      numero INTEGER UNIQUE NOT NULL,
      cedula TEXT NOT NULL,
      id_punto_venta TEXT NOT NULL,
      fecha TEXT DEFAULT (CURRENT_TIMESTAMP),
      subtotal REAL NOT NULL,
      impuestos REAL DEFAULT 0,
      total REAL NOT NULL,
      metodo_pago TEXT,
      metodo_validacion TEXT,
      estado TEXT DEFAULT 'COMPLETADA',
      FOREIGN KEY(cedula) REFERENCES usuarios(cedula),
      FOREIGN KEY(id_punto_venta) REFERENCES puntos_venta(id)
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS detalle_ordenes (
      id TEXT PRIMARY KEY,
      id_orden TEXT NOT NULL,
      id_producto TEXT NOT NULL,
      cantidad INTEGER NOT NULL,
      precio_unitario REAL NOT NULL,
      subtotal REAL NOT NULL,
      notas TEXT,
      FOREIGN KEY(id_orden) REFERENCES ordenes(id) ON DELETE CASCADE,
      FOREIGN KEY(id_producto) REFERENCES productos(id)
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS documentos_equivalentes (
      id TEXT PRIMARY KEY,
      id_orden TEXT UNIQUE NOT NULL,
      numero_documento TEXT UNIQUE NOT NULL,
      tipo_documento TEXT DEFAULT 'DOCUMENTO_EQUIVALENTE',
      cufe TEXT UNIQUE,
      qr_documento TEXT,
      fecha_emision TEXT DEFAULT (CURRENT_TIMESTAMP),
      fecha_envio_correo TEXT,
      estado_envio TEXT DEFAULT 'PENDIENTE',
      intentos_envio INTEGER DEFAULT 0,
      url_documento TEXT,
      cumple_resolucion_000165 INTEGER DEFAULT 1,
      hash_documento TEXT,
      FOREIGN KEY(id_orden) REFERENCES ordenes(id)
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS facturas (
      id TEXT PRIMARY KEY,
      numero TEXT UNIQUE NOT NULL,
      fecha TEXT DEFAULT (CURRENT_TIMESTAMP),
      cedula TEXT NOT NULL,
      id_orden TEXT,
      total REAL NOT NULL,
      detalle TEXT,
      cufe TEXT,
      qr_factura TEXT,
      estado_envio TEXT DEFAULT 'PENDIENTE',
      FOREIGN KEY(cedula) REFERENCES usuarios(cedula),
      FOREIGN KEY(id_orden) REFERENCES ordenes(id)
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS validaciones_acceso (
      id TEXT PRIMARY KEY,
      cedula TEXT NOT NULL,
      metodo_validacion TEXT NOT NULL,
      fecha_hora TEXT DEFAULT (CURRENT_TIMESTAMP),
      id_punto_venta TEXT,
      exitosa INTEGER NOT NULL,
      ip_validacion TEXT,
      mensaje_error TEXT,
      FOREIGN KEY(cedula) REFERENCES usuarios(cedula),
      FOREIGN KEY(id_punto_venta) REFERENCES puntos_venta(id)
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS auditoria (
      id TEXT PRIMARY KEY,
      tabla TEXT NOT NULL,
      id_registro TEXT NOT NULL,
      accion TEXT NOT NULL,
      usuario TEXT,
      cedula_relacionada TEXT,
      fecha_hora TEXT DEFAULT (CURRENT_TIMESTAMP),
      datos_anteriores TEXT,
      datos_nuevos TEXT,
      ip_origen TEXT
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS configuracion_normativa (
      id TEXT PRIMARY KEY,
      parametro TEXT UNIQUE NOT NULL,
      valor TEXT NOT NULL,
      descripcion TEXT,
      resolucion_aplicable TEXT,
      fecha_vigencia TEXT,
      activo INTEGER DEFAULT 1,
      fecha_actualizacion TEXT DEFAULT (CURRENT_TIMESTAMP)
    );
  `);

  console.log('✅ Base de datos inicializada correctamente');
  return db;
}

// ============ FUNCIONES AUXILIARES ============

export function generarCodigoQR(cedula) {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `UDINING:${cedula}:${timestamp}:${random}`;
}

export async function generarCUFE(numeroDocumento, fecha, total, nitEmpresa) {
  const { createHash } = await import('crypto');
  const data = `${numeroDocumento}${fecha}${total}${nitEmpresa}`;
  return createHash('sha256').update(data).digest('hex').toUpperCase();
}

export async function obtenerConsecutivoDocumento(db, prefijo = 'UDINING') {
  const fecha = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const ultimoDoc = await db.get(`
    SELECT numero_documento 
    FROM documentos_equivalentes 
    WHERE numero_documento LIKE '${prefijo}-${fecha}%'
    ORDER BY numero_documento DESC 
    LIMIT 1
  `);
  
  let consecutivo = 1;
  if (ultimoDoc) {
    const partes = ultimoDoc.numero_documento.split('-');
    consecutivo = parseInt(partes[partes.length - 1]) + 1;
  }
  return `${prefijo}-${fecha}-${consecutivo.toString().padStart(6, '0')}`;
}

export async function registrarAuditoria(db, tabla, idRegistro, accion, datosAnteriores, datosNuevos, usuario = 'SISTEMA', cedula = null, ip = null) {
  const { v4: uuidv4 } = await import('uuid');
  await db.run(`
    INSERT INTO auditoria (
      id, tabla, id_registro, accion, usuario, cedula_relacionada,
      datos_anteriores, datos_nuevos, ip_origen
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    uuidv4(),
    tabla,
    idRegistro,
    accion,
    usuario,
    cedula,
    JSON.stringify(datosAnteriores),
    JSON.stringify(datosNuevos),
    ip
  ]);
}
