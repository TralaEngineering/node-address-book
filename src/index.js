'use strict';

const _ = require('lodash');
const Boom = require('boom');
const Hapi = require('@hapi/hapi');
const HapiSwagger = require('hapi-swagger');
const Inert = require('@hapi/inert');
const JoiBase = require('joi');
const JoiDate = require ('@hapi/joi-date');
const Pack = require('../package');
const Vision = require('@hapi/vision');

const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');

const Joi = JoiBase.extend(JoiDate); // Extend Joi with Joi Date

// Database
const pool = new Pool({
    user: process.env.PG_USERNAME,
    database: process.env.PG_DATABASE,
    password: process.env.PG_PASSWORD,
    port: process.env.PG_PORT,
    host: process.env.PG_HOSTNAME,
  });

// API
const init = async () => {
    const server = Hapi.server({ port: 8080, host: '0.0.0.0' });
    const swaggerOptions = { info: { title: 'Trala Address Book API', version: Pack.version } };

    await server.register([ Inert, Vision, {
        plugin: HapiSwagger,
        options: swaggerOptions
    }]);

    // Routes
    server.route({
        method: 'GET',
        path: '/v1/contact/{id}',
        options: { cors: true, tags: ['api'] },
        handler: async (request, h) => {
            try {
                const { id: contactId } = request.params;
                const res = await pool.query("SELECT * FROM contacts WHERE id = $1", [ contactId ]);
                return res.rows[0] || {};
            } catch (error) { return Boom.internal(error); }
        }
    });
    server.route({
        method: 'GET',
        path: '/v1/contacts',
        options: { cors: true, tags: ['api'] },
        handler: async (request, h) => {
            try {
                const res = await pool.query("SELECT * FROM contacts");
                return res.rows || [];
            } catch (error) { return Boom.internal(error); }
        }
    });
    server.route({
        method: 'POST',
        path: '/v1/contact',
        options: {
            cors: true,
            tags: ['api'],
            validate: {
                payload: Joi.object({
                    email: Joi.string().min(1).max(255).required(),
                    first_name: Joi.string().min(1).max(128).optional(),
                    middle_initial: Joi.string().min(1).max(128).optional(),
                    last_name: Joi.string().min(1).max(128).optional(),
                    birth_date: Joi.date()
                        .format('YYYY-MM-DD').optional(),
                    country_code: Joi.string().min(1).max(8).optional(),
                    phone_number: Joi.string().min(1).max(24).optional(),
                }),
                failAction: async (request, h, err) => {
                    // Log and respond with the full error.
                    console.error(err);
                    throw err;
                },
            }
        },
        handler: async (request, h) => {
            const { payload } = request;
            const contact = {
                id: uuidv4(),
                email: _.get(payload, 'email') || null,
                first_name: _.get(payload, 'first_name') || null,
                middle_initial: _.get(payload, 'middle_initial') || null,
                last_name: _.get(payload, 'last_name') || null,
                birth_date: _.get(payload, 'birth_date') || null,
                country_code: _.get(payload, 'country_code') || null,
                phone_number: _.get(payload, 'phone_number') || null,
            };
            try {
                // Ensure that the date provided is not in the future
                if (new Date(contact.birth_date) > new Date()) {
                    const boomError = Boom.badRequest('"birth_date" must be in the past.');
                    boomError.output.payload.validation = { source: 'payload', keys: ['birth_date'] };
                    return boomError;
                }

                // Let's check to make sure this email address isn't already taken.
                const validRes = await pool.query("SELECT * FROM contacts WHERE email = $1", [ contact.email ]);
                if (validRes.rows.length > 0) return Boom.conflict('That email address already exists');
                const insertRes = await pool.query(
                    "INSERT INTO contacts(id, email, first_name, middle_initial, last_name, birth_date, country_code, phone_number) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *",
                    [ contact.id, contact.email, contact.first_name, contact.middle_initial, contact.last_name, contact.birth_date, contact.country_code, contact.phone_number ],
                );
                return insertRes.rows[0];
            } catch (error) { return Boom.internal(error); }
        }
    });
    server.route({
        method: 'PUT',
        path: '/v1/contact/{id}',
        options: {
            cors: true,
            tags: ['api'],
            validate: {
                params: Joi.object({
                    id: Joi.string().min(36).max(36).required(),
                }),
                payload: Joi.object({
                    email: Joi.string().min(1).max(255).optional(),
                    first_name: Joi.string().min(1).max(128).optional(),
                    middle_initial: Joi.string().min(1).max(128).optional(),
                    last_name: Joi.string().min(1).max(128).optional(),
                    birth_date: Joi.date().format('YYYY-MM-DD').optional(),
                    country_code: Joi.string().min(1).max(8).optional(),
                    phone_number: Joi.string().min(1).max(24).optional(),
                }),
                failAction: async (request, h, err) => {
                    // Log and respond with the full error.
                    console.error(err);
                    throw err;
                },
            }
        },
        handler: async (request, h) => {
            const { id: contactId } = request.params;
            const { payload } = request;
            const updatedContact = {};

            if (_.get(payload, 'email')) _.set(updatedContact, 'email', payload.email);
            if (_.get(payload, 'first_name')) _.set(updatedContact, 'first_name', payload.first_name);
            if (_.get(payload, 'middle_initial')) _.set(updatedContact, 'middle_initial', payload.middle_initial);
            if (_.get(payload, 'last_name')) _.set(updatedContact, 'last_name', payload.last_name);
            if (_.get(payload, 'birth_date')) _.set(updatedContact, 'birth_date', payload.birth_date);
            if (_.get(payload, 'country_code')) _.set(updatedContact, 'country_code', payload.country_code);
            if (_.get(payload, 'phone_number')) _.set(updatedContact, 'phone_number', payload.phone_number);
            try {
                // Ensure that the date provided is not in the future
                if (new Date(updatedContact.birth_date) > new Date()) {
                    const boomError = Boom.badRequest('"birth_date" must be in the past.');
                    boomError.output.payload.validation = { source: 'payload', keys: ['birth_date'] };
                    return boomError;
                }

                // Let's make sure this exists
                const findRes = await pool.query("SELECT * FROM contacts WHERE id = $1", [ contactId ]);
                if (findRes.rows.length === 0) return Boom.badRequest('There is no contact with that identifier.');
                const existingContact = findRes.rows[0];

                if (updatedContact.email) {
                    // Let's check to make sure this email address isn't already taken.
                    const validRes = await pool.query("SELECT * FROM contacts WHERE email = $1 AND id != $2", [ updatedContact.email, contactId ]);
                    if (validRes.rows.length > 0) return Boom.conflict('That email address already exists');
                }

                const contact = _.merge(existingContact, updatedContact);
                const updateRes = await pool.query(
                    "UPDATE contacts SET email=$2, first_name=$3, middle_initial=$4, last_name=$5, birth_date=$6, country_code=$7, phone_number=$8 WHERE id=$1 RETURNING *",
                    [ contactId, contact.email, contact.first_name, contact.middle_initial, contact.last_name, contact.birth_date, contact.country_code, contact.phone_number ],
                );
                return updateRes.rows[0];
            } catch (error) {
                console.log(error);
                return Boom.internal(error);
            }
        }
    });
    server.route({
        method: 'DELETE',
        path: '/v1/contact/{id}',
        options: {
            cors: true,
            tags: ['api'],
            validate: {
                params: Joi.object({
                    id: Joi.string().min(36).max(36).required(),
                }),
            }
        },
        handler: async (request, h) => {
            const { id: contactId } = request.params;
            try {
                // Let's make sure this exists
                const findRes = await pool.query("SELECT * FROM contacts WHERE id = $1", [ contactId ]);
                if (findRes.rows.length === 0) return Boom.badRequest('There is no contact with that identifier.');

                const updateRes = await pool.query(
                    "UPDATE contacts SET is_active = $2 WHERE id=$1 RETURNING *",
                    [ contactId, false ],
                );
                return updateRes.rows[0];
            } catch (error) {
                console.log(error);
                return Boom.internal(error);
            }
        }
    });

    await server.start();
    console.log('Server running on %s', server.info.uri);
};

process.on('unhandledRejection', (err) => {
    console.log(err);
    process.exit(1);
});

init();