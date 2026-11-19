package com.dsh.livesubtitle

/**
 * Energy VAD segmenter for a 16 kHz mono stream: cuts on ~0.4 s pauses, keeps at
 * most 4.5 s per utterance.
 */
class Segmenter(private val onSegment: (FloatArray) -> Unit) {
    private val rate = 16000
    private val frameSize = 320 // 20 ms
    private var pending = FloatArray(0)
    private var speaking = false
    private val blocks = ArrayList<FloatArray>()
    private var total = 0
    private var silence = 0
    private var noise = 0.004f
    private var threshold = 0.007f
    private val preroll = ArrayList<FloatArray>()
    private var prerollCount = 0
    private var lastEmitted = 0L

    fun feed(chunk: FloatArray) {
        val merged = FloatArray(pending.size + chunk.size)
        System.arraycopy(pending, 0, merged, 0, pending.size)
        System.arraycopy(chunk, 0, merged, pending.size, chunk.size)
        var offset = 0
        while (offset + frameSize <= merged.size) {
            frame(merged.copyOfRange(offset, offset + frameSize))
            offset += frameSize
        }
        pending = merged.copyOfRange(offset, merged.size)
    }

    private fun frame(samples: FloatArray) {
        var sum = 0.0
        for (value in samples) {
            val v = value.toDouble()
            sum += v * v
        }
        val rms = kotlin.math.sqrt(sum / samples.size).toFloat()
        if (!speaking) {
            noise = noise * 0.98f + rms * 0.02f
            threshold = maxOf(0.007f, minOf(0.05f, noise * 2.4f + 0.0015f))
            preroll.add(samples)
            prerollCount += samples.size
            while (prerollCount > rate * 0.4f && preroll.size > 1) {
                prerollCount -= preroll[0].size
                preroll.removeAt(0)
            }
            if (rms > threshold) {
                speaking = true
                silence = 0
                blocks.clear()
                blocks.addAll(preroll)
                total = prerollCount
                preroll.clear()
                prerollCount = 0
            }
            return
        }
        blocks.add(samples)
        total += samples.size
        if (rms > threshold) silence = 0 else silence += samples.size
        if ((silence >= rate * 0.4f && total >= rate * 0.6f) || total >= rate * 4.5f) {
            finish()
        }
    }

    private fun finish() {
        val captured = ArrayList(blocks)
        val capturedTotal = total
        speaking = false
        blocks.clear()
        total = 0
        silence = 0
        if (capturedTotal < rate * 0.45f) return
        val merged = FloatArray(capturedTotal)
        var offset = 0
        for (block in captured) {
            System.arraycopy(block, 0, merged, offset, block.size)
            offset += block.size
        }
        val trimmed = trim(merged)
        if (trimmed.size < rate * 0.4f) return
        val now = System.currentTimeMillis()
        if (now - lastEmitted < 300) return
        lastEmitted = now
        onSegment(trimmed)
    }

    private fun trim(samples: FloatArray): FloatArray {
        val frame = 160
        var start = 0
        var end = samples.size
        while (start + frame < end && rms(samples, start, frame) < threshold * 0.6f) start += frame
        while (end - frame > start && rms(samples, end - frame, frame) < threshold * 0.6f) end -= frame
        start = maxOf(0, start - 80)
        end = minOf(samples.size, end + 80)
        return samples.copyOfRange(start, end)
    }

    private fun rms(samples: FloatArray, start: Int, count: Int): Float {
        val end = minOf(samples.size, start + count)
        var sum = 0.0
        for (i in start until end) {
            val v = samples[i].toDouble()
            sum += v * v
        }
        return kotlin.math.sqrt(sum / maxOf(1, end - start)).toFloat()
    }
}
