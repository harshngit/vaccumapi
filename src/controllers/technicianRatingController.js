// ============================================================
// src/controllers/technicianRatingController.js
// ============================================================

const pool = require('../config/db');
const { sendError, Errors } = require('../utils/AppError');
const ERROR_CODES = require('../utils/errorCodes');
const { logActivity } = require('./activityController');

// ────────────────────────────────────────────────────────────
// Helper: recalculate average rating on the technicians row
// ────────────────────────────────────────────────────────────
const recalcAvgRating = async (client, technicianId) => {
  await client.query(
    `UPDATE technicians
     SET rating = COALESCE(
       (SELECT ROUND(AVG(rating), 2) FROM technician_ratings WHERE technician_id = $1),
       0
     )
     WHERE id = $1`,
    [technicianId]
  );
};

// ────────────────────────────────────────────────────────────
// POST /api/technicians/:id/ratings
// Add a rating for a technician (optionally tied to a job)
// ────────────────────────────────────────────────────────────
const addRating = async (req, res) => {
  const client = await pool.connect();
  try {
    const techId = parseInt(req.params.id);
    if (isNaN(techId)) {
      return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR,
        'Invalid technician ID.', { field: 'id' });
    }

    const techCheck = await client.query(
      'SELECT id, name FROM technicians WHERE id = $1', [techId]
    );
    if (techCheck.rows.length === 0) return Errors.technicianNotFound(res);

    const { rating, review, job_id } = req.body;

    if (!rating || rating < 1 || rating > 5) {
      return sendError(res, 400, ERROR_CODES.INVALID_RATING,
        'Rating is required and must be between 1 and 5.',
        { field: 'rating', allowed: '1.0 – 5.0' });
    }

    const roundedRating = Math.round(parseFloat(rating) * 2) / 2;

    if (job_id) {
      const jobCheck = await client.query(
        'SELECT id, technician_id, status FROM jobs WHERE id = $1', [job_id]
      );
      if (jobCheck.rows.length === 0) {
        return sendError(res, 404, ERROR_CODES.JOB_NOT_FOUND, 'Job not found.');
      }
      if (jobCheck.rows[0].status !== 'Closed') {
        return sendError(res, 400, ERROR_CODES.JOB_NOT_CLOSED,
          'Can only rate a technician for a closed job.',
          { current_status: jobCheck.rows[0].status });
      }
      if (jobCheck.rows[0].technician_id !== techId) {
        return sendError(res, 400, ERROR_CODES.JOB_NOT_ASSIGNED_TO_TECH,
          'This job is not assigned to this technician.');
      }

      const dupCheck = await client.query(
        'SELECT id FROM technician_ratings WHERE technician_id = $1 AND job_id = $2',
        [techId, job_id]
      );
      if (dupCheck.rows.length > 0) {
        return sendError(res, 409, ERROR_CODES.DUPLICATE_RATING,
          'This technician has already been rated for this job.',
          { existing_rating_id: dupCheck.rows[0].id });
      }
    }

    await client.query('BEGIN');

    const result = await client.query(
      `INSERT INTO technician_ratings (technician_id, job_id, rating, review, rated_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [techId, job_id || null, roundedRating, review || null, req.user.id]
    );

    await recalcAvgRating(client, techId);

    const avgResult = await client.query(
      'SELECT rating FROM technicians WHERE id = $1', [techId]
    );

    await client.query('COMMIT');

    await logActivity({
      type:         'technician',
      action:       `Technician "${techCheck.rows[0].name}" rated ${roundedRating}/5${job_id ? ` for ${job_id}` : ''}`,
      entity_type:  'technician',
      entity_id:    String(techId),
      performed_by: req.user.id,
    });

    return res.status(201).json({
      success: true,
      message: `Rating ${roundedRating}/5 added successfully.`,
      data: {
        ...result.rows[0],
        average_rating: parseFloat(avgResult.rows[0].rating),
      },
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Add rating error:', error);
    return Errors.internalError(res);
  } finally {
    client.release();
  }
};

// ────────────────────────────────────────────────────────────
// GET /api/technicians/:id/ratings
// List all ratings for a technician
// ────────────────────────────────────────────────────────────
const getRatings = async (req, res) => {
  try {
    const techId = parseInt(req.params.id);
    if (isNaN(techId)) {
      return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR,
        'Invalid technician ID.', { field: 'id' });
    }

    const techCheck = await pool.query(
      'SELECT id, name, rating FROM technicians WHERE id = $1', [techId]
    );
    if (techCheck.rows.length === 0) return Errors.technicianNotFound(res);

    const result = await pool.query(
      `SELECT tr.*,
              u.first_name || ' ' || u.last_name AS rated_by_name,
              j.title AS job_title
       FROM technician_ratings tr
       LEFT JOIN users u ON u.id = tr.rated_by
       LEFT JOIN jobs j ON j.id = tr.job_id
       WHERE tr.technician_id = $1
       ORDER BY tr.created_at DESC`,
      [techId]
    );

    return res.status(200).json({
      success: true,
      average_rating: parseFloat(techCheck.rows[0].rating),
      total_ratings:  result.rows.length,
      data:           result.rows,
    });

  } catch (error) {
    console.error('Get ratings error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// PUT /api/technicians/:id/ratings/:ratingId
// Update an existing rating
// ────────────────────────────────────────────────────────────
const updateRating = async (req, res) => {
  const client = await pool.connect();
  try {
    const techId   = parseInt(req.params.id);
    const ratingId = parseInt(req.params.ratingId);
    if (isNaN(techId) || isNaN(ratingId)) {
      return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR,
        'Invalid technician ID or rating ID.');
    }

    const ratingCheck = await client.query(
      'SELECT * FROM technician_ratings WHERE id = $1 AND technician_id = $2',
      [ratingId, techId]
    );
    if (ratingCheck.rows.length === 0) {
      return sendError(res, 404, ERROR_CODES.VALIDATION_ERROR,
        'Rating not found for this technician.');
    }

    const { rating, review } = req.body;

    if (rating !== undefined && (rating < 1 || rating > 5)) {
      return sendError(res, 400, ERROR_CODES.INVALID_RATING,
        'Rating must be between 1 and 5.',
        { field: 'rating', allowed: '1.0 – 5.0' });
    }

    if (rating === undefined && review === undefined) {
      return sendError(res, 400, ERROR_CODES.NO_FIELDS_TO_UPDATE,
        'No fields provided to update.');
    }

    const cur = ratingCheck.rows[0];
    const newRating = rating !== undefined ? Math.round(parseFloat(rating) * 2) / 2 : cur.rating;
    const newReview = review !== undefined ? (review || null) : cur.review;

    await client.query('BEGIN');

    const result = await client.query(
      `UPDATE technician_ratings SET rating = $1, review = $2 WHERE id = $3 RETURNING *`,
      [newRating, newReview, ratingId]
    );

    await recalcAvgRating(client, techId);

    const avgResult = await client.query(
      'SELECT rating FROM technicians WHERE id = $1', [techId]
    );

    await client.query('COMMIT');

    return res.status(200).json({
      success: true,
      message: 'Rating updated successfully.',
      data: {
        ...result.rows[0],
        average_rating: parseFloat(avgResult.rows[0].rating),
      },
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Update rating error:', error);
    return Errors.internalError(res);
  } finally {
    client.release();
  }
};

// ────────────────────────────────────────────────────────────
// DELETE /api/technicians/:id/ratings/:ratingId
// Delete a rating
// ────────────────────────────────────────────────────────────
const deleteRating = async (req, res) => {
  const client = await pool.connect();
  try {
    const techId   = parseInt(req.params.id);
    const ratingId = parseInt(req.params.ratingId);
    if (isNaN(techId) || isNaN(ratingId)) {
      return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR,
        'Invalid technician ID or rating ID.');
    }

    const ratingCheck = await client.query(
      'SELECT * FROM technician_ratings WHERE id = $1 AND technician_id = $2',
      [ratingId, techId]
    );
    if (ratingCheck.rows.length === 0) {
      return sendError(res, 404, ERROR_CODES.VALIDATION_ERROR,
        'Rating not found for this technician.');
    }

    await client.query('BEGIN');

    await client.query('DELETE FROM technician_ratings WHERE id = $1', [ratingId]);
    await recalcAvgRating(client, techId);

    const avgResult = await client.query(
      'SELECT rating FROM technicians WHERE id = $1', [techId]
    );

    await client.query('COMMIT');

    return res.status(200).json({
      success: true,
      message: 'Rating deleted successfully.',
      average_rating: parseFloat(avgResult.rows[0].rating),
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Delete rating error:', error);
    return Errors.internalError(res);
  } finally {
    client.release();
  }
};

module.exports = {
  addRating,
  getRatings,
  updateRating,
  deleteRating,
};
