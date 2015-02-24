<?php
/**
 *
 * @package ManneBusk_DevPanel
 * @module  ManneBusk
 * @author  ManneBusk <mannebusk@gmail.com>
 */
class ManneBusk_DevPanel_Block_Tab
    extends ManneBusk_DevPanel_Block_Panel
{
    /**
     * isActive
     *
     * @return boolean
     */
    public function isActive()
    {
        return $this->getActive();
    }

    /**
     * setActive
     *
     * @return ManneBusk_DevPanel_Block_Panel
     */
    public function setActive()
    {
        return $this->setActive(true);
    }

    /**
     * setTitle
     *
     * @param string $title
     *
     * @return ManneBusk_DevPanel_Block_Panel
     */
    public function setTitle($title)
    {
        return $this->setData('title', $title);
    }

    /**
     * getTitle
     *
     * @return string
     */
    public function getTitle()
    {
        return $this->getData('title');
    }
}
