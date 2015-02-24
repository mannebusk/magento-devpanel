<?php
/**
 *
 * @package ManneBusk_DevPanel
 * @module  ManneBusk
 * @author  ManneBusk <mannebusk@gmail.com>
 */
class ManneBusk_DevPanel_Block_Ajax_Output
    extends Mage_Core_Block_Template
{
    /**
     * Template
     *
     * @var string
     */
    protected $_template = 'devpanel/ajax/message.phtml';

    /**
     * Status Class
     *
     * @var string
     */
    protected $_statusClass = 'success';

    /**
     * Get the status class
     *
     * @return string
     */
    public function getStatusClass()
    {
        return $this->_statusClass;
    }

    /**
     * Set status class
     *
     * @param string $class
     *
     * @return ManneBusk_DevPanel_Block_Ajax_Output
     */
    public function setStatusClass(string $class)
    {
        $this->_statusClass = $class;

        return $this;
    }

    /**
     * Get Output as JSON
     *
     * @return string
     */
    public function getJSON()
    {
        $this->setData('html', $this->toHtml());
        return Mage::helper('core')->jsonEncode($this->getData());
    }
}
